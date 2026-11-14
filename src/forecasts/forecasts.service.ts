import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../clock/clock';
import type { Location } from '../locations/location';
import { SourceRefreshError, type SourceFailureCode } from './forecast.errors';
import { checkCoverage, sameWindow, type ForecastWindow } from './forecast-window';
import { ForecastsRepository } from './forecasts.repository';
import { OpenMeteoAtmosphericClient } from './open-meteo-atmospheric.client';
import type { OpenMeteoForecastClient } from './open-meteo-forecast';
import { OpenMeteoMarineClient } from './open-meteo-marine.client';
import type { WeatherSnapshot, WeatherSource } from './weather-source';

/** A coverage-complete snapshot younger than this is reused without a refresh (SPEC-02). */
export const FRESH_FOR_MS = 6 * 60 * 60 * 1000;
/** After a failed refresh, a coverage-complete snapshot up to this old is served as stale. */
export const STALE_FALLBACK_MS = 24 * 60 * 60 * 1000;

export interface SourceFailure {
  code: SourceFailureCode;
  /** Client-facing explanation, free of provider text. */
  reason: string;
}

/**
 * One source's outcome for a request, matching the GraphQL `SourceStatus`:
 * FRESH and STALE carry the snapshot they reuse, STALE and UNAVAILABLE the
 * refresh failure. A fresh snapshot can still hold null measurements.
 */
export type SourceResult =
  | { source: WeatherSource; freshness: 'FRESH'; snapshot: WeatherSnapshot }
  | { source: WeatherSource; freshness: 'STALE'; snapshot: WeatherSnapshot; failure: SourceFailure }
  | { source: WeatherSource; freshness: 'UNAVAILABLE'; failure: SourceFailure };

export interface ForecastWeather {
  window: ForecastWindow;
  atmospheric: SourceResult;
  marine: SourceResult;
}

/** The result of one shared refresh, judged against the window of the caller that started it. */
type RefreshOutcome =
  | { window: ForecastWindow; ok: true; snapshot: WeatherSnapshot }
  | { window: ForecastWindow; ok: false; failure: SourceFailure };

/**
 * Owns forecast snapshots: reuse, request-driven refresh and fallback for the
 * atmospheric and marine sources, each tracked independently (SPEC-02, ADR 0003).
 *
 * Source failures never throw: they become STALE or UNAVAILABLE results.
 * ForecastStorageUnavailableError propagates when PostgreSQL cannot serve the call.
 */
@Injectable()
export class ForecastsService {
  private readonly logger = new Logger(ForecastsService.name);
  /** One in-flight refresh per location and source, shared by every caller in this process. */
  private readonly inFlight = new Map<string, Promise<RefreshOutcome>>();
  private readonly clients: readonly OpenMeteoForecastClient[];

  constructor(
    private readonly repository: ForecastsRepository,
    atmospheric: OpenMeteoAtmosphericClient,
    marine: OpenMeteoMarineClient,
    private readonly clock: Clock,
  ) {
    this.clients = [atmospheric, marine];
  }

  /**
   * Weather for the window's seven dates, one result per source. `window` is
   * frozen by the caller from its request instant and the location's time zone.
   */
  async getWeather(location: Location, window: ForecastWindow): Promise<ForecastWeather> {
    if (window.timezone !== location.timezone) {
      throw new Error(
        `The window is in ${window.timezone}, but ${location.id} is in ${location.timezone}.`,
      );
    }
    const [atmospheric, marine] = await Promise.all(
      this.clients.map((client) => this.getSource(location, window, client)),
    );
    return { window, atmospheric, marine };
  }

  private async getSource(
    location: Location,
    window: ForecastWindow,
    client: OpenMeteoForecastClient,
  ): Promise<SourceResult> {
    const { source, schemaVersion } = client.spec;
    const stored = await this.repository.findSnapshot(location.id, source, schemaVersion);
    if (stored !== null && this.ageOf(stored) < FRESH_FOR_MS && covers(stored, window, client)) {
      return { source, freshness: 'FRESH', snapshot: stored };
    }

    let outcome = await this.refresh(location, window, client);
    if (outcome.ok && covers(outcome.snapshot, window, client)) {
      return { source, freshness: 'FRESH', snapshot: outcome.snapshot };
    }
    const candidates = [outcome.ok ? outcome.snapshot : null, stored];

    // A caller that joined a refresh started for another date window — typically
    // one frozen before local midnight — gets one more refresh for its own window.
    if (!sameWindow(outcome.window, window)) {
      outcome = await this.refresh(location, window, client);
      if (outcome.ok && covers(outcome.snapshot, window, client)) {
        return { source, freshness: 'FRESH', snapshot: outcome.snapshot };
      }
      candidates.unshift(outcome.ok ? outcome.snapshot : null);
    }

    const failure = outcome.ok ? insufficientCoverage(client, window) : outcome.failure;
    const fallback = candidates.find(
      (snapshot): snapshot is WeatherSnapshot =>
        snapshot !== null &&
        this.ageOf(snapshot) <= STALE_FALLBACK_MS &&
        covers(snapshot, window, client),
    );
    return fallback === undefined
      ? { source, freshness: 'UNAVAILABLE', failure }
      : { source, freshness: 'STALE', snapshot: fallback, failure };
  }

  /** Joins the in-flight refresh for this location and source, or starts one for `window`. */
  private refresh(
    location: Location,
    window: ForecastWindow,
    client: OpenMeteoForecastClient,
  ): Promise<RefreshOutcome> {
    const key = `${location.id}:${client.spec.source}`;
    const running = this.inFlight.get(key);
    if (running !== undefined) {
      return running;
    }
    const refresh = this.runRefresh(location, window, client).finally(() => {
      if (this.inFlight.get(key) === refresh) {
        this.inFlight.delete(key);
      }
    });
    this.inFlight.set(key, refresh);
    return refresh;
  }

  /**
   * Fetches, validates the payload and its coverage of `window`, then upserts.
   * Anything that fails validation is never written, so the previous snapshot stays.
   */
  private async runRefresh(
    location: Location,
    window: ForecastWindow,
    client: OpenMeteoForecastClient,
  ): Promise<RefreshOutcome> {
    let snapshot: WeatherSnapshot;
    try {
      const forecast = await client.fetchForecast(location);
      if (!covers(forecast, window, client)) {
        throw new SourceRefreshError(
          'INSUFFICIENT_COVERAGE',
          insufficientCoverage(client, window).reason,
        );
      }
      // Taken after the provider answers, so the age runs from when the data was fetched.
      snapshot = { ...forecast, locationId: location.id, fetchedAt: this.clock.now() };
    } catch (error) {
      if (!(error instanceof SourceRefreshError)) {
        throw error;
      }
      this.logger.warn(
        `${client.spec.label} refresh failed for location ${location.id} (${error.code})`,
      );
      return { window, ok: false, failure: { code: error.code, reason: error.message } };
    }
    await this.repository.saveSnapshot(snapshot);
    return { window, ok: true, snapshot };
  }

  private ageOf(snapshot: WeatherSnapshot): number {
    return this.clock.now().getTime() - snapshot.fetchedAt.getTime();
  }
}

function covers(
  forecast: Pick<WeatherSnapshot, 'hourly'>,
  window: ForecastWindow,
  client: OpenMeteoForecastClient,
): boolean {
  return checkCoverage(forecast.hourly.time, window, client.spec.requiredLocalHours).complete;
}

function insufficientCoverage(
  client: OpenMeteoForecastClient,
  window: ForecastWindow,
): SourceFailure {
  return {
    code: 'INSUFFICIENT_COVERAGE',
    reason: `${client.spec.label} does not cover the required local hours from ${window.dates[0]} to ${window.dates[window.dates.length - 1]}.`,
  };
}
