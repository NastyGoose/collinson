import { Inject, Injectable, Logger } from '@nestjs/common';
import { HTTP_FETCH, type HttpFetch } from '../http/http-fetch';
import { MAX_CANDIDATES, type Location } from './location';
import { GeocodingUnavailableError } from './location.errors';

export const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** Per-attempt limit, matching the Technical Design's upstream policy. */
export const GEOCODING_TIMEOUT_MS = 5_000;

/**
 * Rows requested from the provider. More than MAX_CANDIDATES, so that a record
 * dropped as unusable or duplicate does not hide a valid fifth candidate.
 */
export const GEOCODING_REQUEST_COUNT = 10;

/** One raw entry of the provider's `results` array. Every field is untrusted. */
interface RawGeocodingResult {
  id?: unknown;
  name?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  country_code?: unknown;
  country?: unknown;
  admin1?: unknown;
  timezone?: unknown;
}

/**
 * Open-Meteo geocoding adapter. Returns up to five valid, distinct candidates in
 * the provider's order, or an empty list for a genuine no-match. Anything else —
 * a timeout, an HTTP error, a malformed body, or results of which none is usable —
 * is a GeocodingUnavailableError, so callers never mistake an outage for an
 * unknown town. https://open-meteo.com/en/docs/geocoding-api
 */
@Injectable()
export class OpenMeteoGeocodingClient {
  private readonly logger = new Logger(OpenMeteoGeocodingClient.name);

  constructor(@Inject(HTTP_FETCH) private readonly fetch: HttpFetch) {}

  async search(query: string, countryCode: string | null): Promise<Location[]> {
    const url = new URL(OPEN_METEO_GEOCODING_URL);
    url.searchParams.set('name', query);
    url.searchParams.set('count', String(GEOCODING_REQUEST_COUNT));
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');
    if (countryCode !== null) {
      url.searchParams.set('countryCode', countryCode);
    }

    const body = await this.fetchWithRetry(url);
    return parseGeocodingResponse(body, countryCode);
  }

  /** At most one retry, and only for failures a second attempt can plausibly fix. */
  private async fetchWithRetry(url: URL): Promise<unknown> {
    try {
      return await this.fetchOnce(url);
    } catch (error) {
      if (!(error instanceof GeocodingUnavailableError) || !error.transient) {
        this.logFailure(error);
        throw error;
      }
      this.logger.warn(`Geocoding attempt failed (${error.kind}); retrying once`);
      try {
        return await this.fetchOnce(url);
      } catch (retryError) {
        this.logFailure(retryError);
        throw retryError;
      }
    }
  }

  private async fetchOnce(url: URL): Promise<unknown> {
    let response: Response;
    let text: string;
    try {
      response = await this.fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(GEOCODING_TIMEOUT_MS),
      });
      text = await response.text();
    } catch (error) {
      if (errorName(error) === 'TimeoutError') {
        throw new GeocodingUnavailableError(
          'TIMEOUT',
          `Geocoding did not answer within ${GEOCODING_TIMEOUT_MS} ms.`,
          { cause: error, transient: true },
        );
      }
      throw new GeocodingUnavailableError('NETWORK', 'Geocoding request failed.', {
        cause: error,
        transient: true,
      });
    }

    if (response.status === 429) {
      throw new GeocodingUnavailableError(
        'RATE_LIMITED',
        'Geocoding rate limit reached (HTTP 429).',
      );
    }
    if (!response.ok) {
      throw new GeocodingUnavailableError(
        'UPSTREAM_FAILURE',
        `Geocoding answered HTTP ${response.status}.`,
        { transient: response.status >= 500 },
      );
    }

    try {
      const parsed: unknown = JSON.parse(text);
      return parsed;
    } catch (error) {
      throw new GeocodingUnavailableError(
        'INVALID_PAYLOAD',
        'Geocoding answered with invalid JSON.',
        {
          cause: error,
        },
      );
    }
  }

  private logFailure(error: unknown): void {
    const detail = error instanceof GeocodingUnavailableError ? error.kind : String(error);
    this.logger.warn(`Geocoding unavailable (${detail})`);
  }
}

/**
 * Classifies a parsed 2xx body. Exported for unit tests.
 *
 * - No `results` key, or an empty array: a genuine no-match.
 * - `results` with at least one usable entry: up to five valid, distinct candidates.
 * - Anything else, including a non-empty `results` with no usable entry: a failure.
 */
export function parseGeocodingResponse(body: unknown, countryCode: string | null): Location[] {
  if (!isRecord(body)) {
    throw new GeocodingUnavailableError(
      'INVALID_PAYLOAD',
      'Geocoding answered with a non-object body.',
    );
  }
  if (body.error === true) {
    const reason = typeof body.reason === 'string' ? `: ${body.reason}` : '';
    throw new GeocodingUnavailableError('UPSTREAM_FAILURE', `Geocoding reported an error${reason}`);
  }
  if (body.results === undefined) {
    return [];
  }
  if (!Array.isArray(body.results)) {
    throw new GeocodingUnavailableError('INVALID_PAYLOAD', 'Geocoding results is not an array.');
  }
  if (body.results.length === 0) {
    return [];
  }

  const results: unknown[] = body.results;
  const candidates: Location[] = [];
  const seen = new Set<string>();
  for (const raw of results) {
    const location = toLocation(raw, countryCode);
    if (location === null || seen.has(location.id)) {
      continue;
    }
    seen.add(location.id);
    candidates.push(location);
    if (candidates.length === MAX_CANDIDATES) {
      break;
    }
  }

  if (candidates.length === 0) {
    throw new GeocodingUnavailableError(
      'UNUSABLE_RESULTS',
      `Geocoding returned ${results.length} result(s), none with a usable ID, name, country, coordinates and time zone.`,
    );
  }
  return candidates;
}

/** A usable candidate, or null. Missing time zones and invalid coordinates are never defaulted. */
function toLocation(raw: unknown, countryCode: string | null): Location | null {
  if (!isRecord(raw)) {
    return null;
  }
  const result: RawGeocodingResult = raw;

  if (typeof result.id !== 'number' || !Number.isSafeInteger(result.id) || result.id <= 0) {
    return null;
  }
  const name = nonBlank(result.name);
  const country = nonBlank(result.country);
  const timezone = nonBlank(result.timezone);
  if (name === null || country === null || timezone === null || !isValidTimeZone(timezone)) {
    return null;
  }
  if (!isCoordinate(result.latitude, 90) || !isCoordinate(result.longitude, 180)) {
    return null;
  }
  // The provider applies the filter itself; this guards against it being ignored.
  if (countryCode !== null && result.country_code !== countryCode) {
    return null;
  }

  return {
    id: String(result.id),
    name,
    country,
    region: nonBlank(result.admin1),
    latitude: result.latitude,
    longitude: result.longitude,
    timezone,
  };
}

// Not `instanceof Error`: fetch's DOMException can come from another realm (e.g. under Jest).
function errorName(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof error.name === 'string'
    ? error.name
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonBlank(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isCoordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
