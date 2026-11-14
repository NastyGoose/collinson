import type { Logger } from '@nestjs/common';
import type { HttpFetch } from '../http/http-fetch';
import { forLog, requestJson, UpstreamRequestError } from '../http/json-request';
import type { Location } from '../locations/location';
import { SourceRefreshError, type SourceFailureCode } from './forecast.errors';
import type { HourlySeries, NormalizedForecast, WeatherSource } from './weather-source';

/** Per-attempt limit (SPEC-02). */
export const OPEN_METEO_TIMEOUT_MS = 5_000;

/** Today plus the seven ranked dates, so a request near local midnight still has tomorrow. */
export const FORECAST_DAYS_REQUESTED = 8;

/** What one Open-Meteo forecast API is asked for and how its answer is checked. */
export interface ForecastSourceSpec {
  source: WeatherSource;
  /** Bump when the request or the normalized shape changes; it is part of the snapshot key. */
  schemaVersion: number;
  /** Used in client-facing failure reasons, e.g. "Marine forecast". */
  label: string;
  endpoint: string;
  /** Hourly variables requested, each with the unit the payload must declare. */
  variables: Readonly<Record<string, string>>;
  /** Further query parameters, such as explicit units or grid-cell selection. */
  params: Readonly<Record<string, string>>;
  /** Local hours (0–23) that must be present on every ranked date. */
  requiredLocalHours: readonly number[];
}

export type ForecastLocation = Pick<Location, 'latitude' | 'longitude' | 'timezone'>;

/**
 * Shared Open-Meteo forecast adapter: one bounded request (src/http/json-request.ts),
 * then validation into a NormalizedForecast. Subclasses supply the source spec. Failures surface as
 * SourceRefreshError; nothing here reads or writes storage.
 */
export abstract class OpenMeteoForecastClient {
  abstract readonly spec: ForecastSourceSpec;
  protected abstract readonly logger: Logger;

  protected constructor(private readonly fetch: HttpFetch) {}

  async fetchForecast(location: ForecastLocation): Promise<NormalizedForecast> {
    const { label } = this.spec;
    let body: unknown;
    try {
      body = await requestJson(this.fetch, forecastUrl(this.spec, location), {
        label,
        timeoutMs: OPEN_METEO_TIMEOUT_MS,
        logger: this.logger,
      });
    } catch (error) {
      throw error instanceof UpstreamRequestError ? toRefreshError(error) : error;
    }
    try {
      return parseForecastResponse(body, this.spec, location);
    } catch (error) {
      if (error instanceof SourceRefreshError) {
        const detail = typeof error.cause === 'string' ? `: ${forLog(error.cause)}` : '';
        this.logger.warn(`${label} unavailable (${error.code})${detail}`);
      }
      throw error;
    }
  }
}

/** Maps a failed request to the source failure codes of the Technical Design. */
function toRefreshError(error: UpstreamRequestError): SourceRefreshError {
  const code: SourceFailureCode =
    error.kind === 'TIMEOUT'
      ? 'TIMEOUT'
      : error.kind === 'RATE_LIMITED'
        ? 'RATE_LIMITED'
        : error.kind === 'INVALID_JSON' || error.kind === 'TOO_LARGE'
          ? 'INVALID_PAYLOAD'
          : 'UPSTREAM_FAILURE';
  return new SourceRefreshError(code, error.message, { cause: error, transient: error.transient });
}

/** The request URL: explicit horizon, time zone, Unix timestamps and variables. Exported for tests. */
export function forecastUrl(spec: ForecastSourceSpec, location: ForecastLocation): URL {
  const url = new URL(spec.endpoint);
  url.searchParams.set('latitude', String(location.latitude));
  url.searchParams.set('longitude', String(location.longitude));
  url.searchParams.set('hourly', Object.keys(spec.variables).join(','));
  url.searchParams.set('forecast_days', String(FORECAST_DAYS_REQUESTED));
  url.searchParams.set('timezone', location.timezone);
  url.searchParams.set('timeformat', 'unixtime');
  for (const [name, value] of Object.entries(spec.params)) {
    url.searchParams.set(name, value);
  }
  return url;
}

/**
 * Validates a parsed 2xx body and normalizes it. Exported for unit tests.
 *
 * Checks the structure only: returned coordinates, declared units, strictly
 * increasing integer timestamps, and one number-or-null per timestamp in every
 * requested series. Nulls are kept as they are — a series may be entirely null —
 * and date coverage is checked separately against each caller's window.
 */
export function parseForecastResponse(
  body: unknown,
  spec: ForecastSourceSpec,
  location: ForecastLocation,
): NormalizedForecast {
  const invalid = (detail: string) =>
    new SourceRefreshError('INVALID_PAYLOAD', `${spec.label} payload is invalid: ${detail}.`);

  if (!isRecord(body)) {
    throw invalid('the body is not an object');
  }
  if (body.error === true) {
    // The provider's reason stays in the cause for logs, out of the client-facing message.
    throw new SourceRefreshError('UPSTREAM_FAILURE', `${spec.label} reported an error.`, {
      cause: body.reason,
    });
  }
  if (!isCoordinate(body.latitude, 90) || !isCoordinate(body.longitude, 180)) {
    throw invalid('the returned coordinates are missing or out of range');
  }

  const units = body.hourly_units;
  if (!isRecord(units)) {
    throw invalid('hourly_units is missing');
  }
  if (units.time !== 'unixtime') {
    throw invalid('timestamps are not Unix time');
  }
  for (const [variable, unit] of Object.entries(spec.variables)) {
    if (units[variable] !== unit) {
      // The declared unit is provider text: name only the variable and the expected unit.
      throw invalid(`${variable} is not in ${unit}`);
    }
  }

  const hourly = body.hourly;
  if (!isRecord(hourly)) {
    throw invalid('hourly is missing');
  }
  const time = parseTimes(hourly.time, invalid);
  const series: HourlySeries['series'] = {};
  for (const variable of Object.keys(spec.variables)) {
    series[variable] = parseSeries(hourly[variable], time.length, variable, invalid);
  }

  return {
    source: spec.source,
    schemaVersion: spec.schemaVersion,
    requested: { latitude: location.latitude, longitude: location.longitude },
    returned: { latitude: body.latitude, longitude: body.longitude },
    timezone: location.timezone,
    units: { ...spec.variables },
    hourly: { time, series },
    coverageStart: new Date(time[0] * 1000),
    coverageEnd: new Date(time[time.length - 1] * 1000),
  };
}

function parseTimes(value: unknown, invalid: (detail: string) => Error): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalid('hourly.time is missing or empty');
  }
  const times: unknown[] = value;
  let previous = -Infinity;
  for (const time of times) {
    // Whole minutes within the range a Date can hold. Zones with :30 or :45 offsets
    // put local hours off the UTC hour, so whole hours are not required.
    if (
      typeof time !== 'number' ||
      !Number.isSafeInteger(time) ||
      time % 60 !== 0 ||
      Math.abs(time) > MAX_UNIX_SECONDS
    ) {
      throw invalid('hourly.time holds a value that is not a valid Unix timestamp');
    }
    if (time <= previous) {
      throw invalid('hourly.time is not strictly increasing');
    }
    previous = time;
  }
  return times as number[];
}

function parseSeries(
  value: unknown,
  length: number,
  variable: string,
  invalid: (detail: string) => Error,
): (number | null)[] {
  if (!Array.isArray(value)) {
    throw invalid(`hourly.${variable} is missing`);
  }
  const samples: unknown[] = value;
  if (samples.length !== length) {
    throw invalid(`hourly.${variable} has ${samples.length} values for ${length} timestamps`);
  }
  for (const sample of samples) {
    if (sample !== null && (typeof sample !== 'number' || !Number.isFinite(sample))) {
      throw invalid(`hourly.${variable} holds a value that is neither a number nor null`);
    }
  }
  return samples as (number | null)[];
}

/** The largest instant a Date can hold, in seconds (ECMAScript: 8.64e15 ms either side of 1970). */
const MAX_UNIX_SECONDS = 8.64e12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCoordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}
