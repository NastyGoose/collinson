import { MAX_CANDIDATES } from './location.constants';
import { GeocodingUnavailableError } from './location.errors';
import type { Location } from './location.types';

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
 * Classifies a parsed 2xx body.
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
    // The provider's reason stays in the cause for logs, out of the client-facing message.
    throw new GeocodingUnavailableError('UPSTREAM_FAILURE', 'Geocoding reported an error.', {
      cause: body.reason,
    });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonBlank(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isCoordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

// IANA names such as "Europe/Berlin" or "UTC": no offsets like "+01:00", which Intl also accepts.
const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

function isValidTimeZone(timezone: string): boolean {
  if (!IANA_TIME_ZONE.test(timezone)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
