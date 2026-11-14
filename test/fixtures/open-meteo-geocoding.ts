/**
 * Controlled Open-Meteo geocoding payloads, shaped like live responses captured on
 * 2026-11-14 (trimmed to the fields the adapter reads plus a few it ignores).
 */

export interface RawResult {
  id?: unknown;
  name?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  elevation?: unknown;
  feature_code?: unknown;
  country_code?: unknown;
  country?: unknown;
  admin1?: unknown;
  timezone?: unknown;
  population?: unknown;
}

export const BERLIN_DE: RawResult = {
  id: 2950159,
  name: 'Berlin',
  latitude: 52.52437,
  longitude: 13.41053,
  elevation: 74,
  feature_code: 'PPLC',
  country_code: 'DE',
  country: 'Germany',
  admin1: 'State of Berlin',
  timezone: 'Europe/Berlin',
  population: 3426354,
};

export const SPRINGFIELD_MO: RawResult = {
  id: 4409896,
  name: 'Springfield',
  latitude: 37.21533,
  longitude: -93.29824,
  country_code: 'US',
  country: 'United States',
  admin1: 'Missouri',
  timezone: 'America/Chicago',
};

export const SPRINGFIELD_IL: RawResult = {
  id: 4250542,
  name: 'Springfield',
  latitude: 39.80172,
  longitude: -89.64371,
  country_code: 'US',
  country: 'United States',
  admin1: 'Illinois',
  timezone: 'America/Chicago',
};

export const SPRINGFIELD_MA: RawResult = {
  id: 4951788,
  name: 'Springfield',
  latitude: 42.10148,
  longitude: -72.58981,
  country_code: 'US',
  country: 'United States',
  admin1: 'Massachusetts',
  timezone: 'America/New_York',
};

export const SAO_PAULO_BR: RawResult = {
  id: 3448439,
  name: 'São Paulo',
  latitude: -23.5475,
  longitude: -46.63611,
  country_code: 'BR',
  country: 'Brazil',
  admin1: 'São Paulo',
  timezone: 'America/Sao_Paulo',
};

/** Geocodes to the PENICHE location of the weather fixtures, so both fixture sets line up. */
export const PENICHE_PT: RawResult = {
  id: 2264508,
  name: 'Peniche',
  latitude: 39.3558,
  longitude: -9.38112,
  feature_code: 'PPL',
  country_code: 'PT',
  country: 'Portugal',
  admin1: 'Leiria',
  timezone: 'Europe/Lisbon',
};

/** A no-match: the provider omits `results` entirely. */
export const NO_MATCH = { generationtime_ms: 0.05 };

export function resultsBody(...results: unknown[]): Record<string, unknown> {
  return { results, generationtime_ms: 0.2 };
}

/** The provider's error envelope, e.g. for an out-of-range parameter (HTTP 400). */
export const PROVIDER_ERROR = { error: true, reason: 'Parameter count must be between 1 and 100.' };
