import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Clock } from '../clock/clock.service';
import type { Location } from '../location/location.types';
import { FRESH_FOR_MS, STALE_FALLBACK_MS } from './forecast.constants';
import { SourceRefreshError } from './forecast.errors';
import { checkCoverage, sameWindow } from '../calendar/calendar.logic';
import type { ForecastWindow } from '../calendar/calendar.types';
import { ForecastRepository } from './forecast.repository';
import { OpenMeteoAtmosphericClient } from './open-meteo-atmospheric.client';
import type { OpenMeteoForecastClient } from './open-meteo-forecast.client';
import { OpenMeteoMarineClient } from './open-meteo-marine.client';
import type {
  ForecastWeather,
  SourceFailure,
  SourceResult,
  WeatherSnapshot,
} from './forecast.types';

/**
 * The result of one shared refresh, judged against the window of the caller that
 * started it. A failure carries the row the refresh found stored when it began.
 */
type RefreshOutcome =
  | { window: ForecastWindow; ok: true; snapshot: WeatherSnapshot }
  | { window: ForecastWindow; ok: false; failure: SourceFailure; stored: WeatherSnapshot | null };

/**
 * Owns forecast snapshots: reuse, request-driven refresh and fallback for the
 * atmospheric and marine sources, each tracked independently (SPEC-02, ADR 0003).
 *
 * Source failures never throw: they become STALE or UNAVAILABLE results.
 * ForecastStorageUnavailableError propagates when PostgreSQL cannot serve the call.
 */
@Injectable()
export class ForecastService {
  /** One in-flight refresh per location and source, shared by every caller in this process. */
  private readonly inFlight = new Map<string, Promise<RefreshOutcome>>();
  private readonly clients: readonly OpenMeteoForecastClient[];

  constructor(
    private readonly repository: ForecastRepository,
    atmospheric: OpenMeteoAtmosphericClient,
    marine: OpenMeteoMarineClient,
    private readonly clock: Clock,
    @InjectPinoLogger(ForecastService.name) private readonly logger: PinoLogger,
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
    if (stored !== null && this.isFresh(stored, window, client)) {
      return { source, freshness: 'FRESH', snapshot: stored };
    }

    let outcome = await this.refresh(location, window, client);
    if (outcome.ok && covers(outcome.snapshot, window, client)) {
      return { source, freshness: 'FRESH', snapshot: outcome.snapshot };
    }
    const candidates = [latestOf(outcome), stored];

    // A caller that joined a refresh started for another date window — typically
    // one frozen before local midnight — gets one more refresh for its own window,
    // unless the joined refresh failed for a reason a new window cannot fix.
    const windowMayHelp = outcome.ok || outcome.failure.code === 'INSUFFICIENT_COVERAGE';
    if (!sameWindow(outcome.window, window) && windowMayHelp) {
      outcome = await this.refresh(location, window, client);
      if (outcome.ok && covers(outcome.snapshot, window, client)) {
        return { source, freshness: 'FRESH', snapshot: outcome.snapshot };
      }
      candidates.unshift(latestOf(outcome));
    }

    const failure = outcome.ok ? insufficientCoverage(client, window) : outcome.failure;
    const fallback = candidates.find(
      (snapshot): snapshot is WeatherSnapshot =>
        snapshot !== null &&
        isAgeWithin(this.ageOf(snapshot), STALE_FALLBACK_MS + 1) &&
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
   * Re-reads the stored row first: a refresh that settled after the caller's own
   * read may already have replaced it, and then it is reused without a fetch.
   * Otherwise fetches, validates the payload and its coverage of `window`, then
   * upserts. Anything that fails validation is never written.
   */
  private async runRefresh(
    location: Location,
    window: ForecastWindow,
    client: OpenMeteoForecastClient,
  ): Promise<RefreshOutcome> {
    const { source, schemaVersion } = client.spec;
    const stored = await this.repository.findSnapshot(location.id, source, schemaVersion);
    if (stored !== null && this.isFresh(stored, window, client)) {
      return { window, ok: true, snapshot: stored };
    }

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
      return {
        window,
        ok: false,
        failure: { code: error.code, reason: error.message },
        stored,
      };
    }
    await this.repository.saveSnapshot(snapshot);
    return { window, ok: true, snapshot };
  }

  private isFresh(
    snapshot: WeatherSnapshot,
    window: ForecastWindow,
    client: OpenMeteoForecastClient,
  ): boolean {
    return isAgeWithin(this.ageOf(snapshot), FRESH_FOR_MS) && covers(snapshot, window, client);
  }

  private ageOf(snapshot: WeatherSnapshot): number {
    return this.clock.now().getTime() - snapshot.fetchedAt.getTime();
  }
}

/**
 * True for an age in [0, limit). A snapshot dated in the future (the clock was set
 * back, or the row was edited) is never trusted as recent.
 */
function isAgeWithin(ageMs: number, limitMs: number): boolean {
  return ageMs >= 0 && ageMs < limitMs;
}

function latestOf(outcome: RefreshOutcome): WeatherSnapshot | null {
  return outcome.ok ? outcome.snapshot : outcome.stored;
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
