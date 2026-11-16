/** Most candidates a city search exposes (SPEC-01). */
export const MAX_CANDIDATES = 5;

/**
 * LocationNotFound messages. Fixed text: they never echo the submitted city,
 * country filter or ID, so a client cannot reflect its own input through them (ARC-59).
 */
export const CITY_NOT_FOUND_MESSAGE = 'No location matches the city search.';
export const LOCATION_ID_NOT_FOUND_MESSAGE = 'No stored location has the given ID.';

export const CITY_MIN_LENGTH = 2;
export const CITY_MAX_LENGTH = 120;

/** How long a search with candidates is reused (SPEC-01). */
export const SEARCH_MATCH_TTL_MS = 24 * 60 * 60 * 1000;
/** How long a genuine no-match is reused (SPEC-01). */
export const SEARCH_EMPTY_TTL_MS = 60 * 60 * 1000;

/** Most expired searches one purge deletes, so each purge stays small. */
export const PURGE_BATCH_SIZE = 100;

export const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** Per-attempt limit, reusing the Technical Design's weather-provider policy for consistency. */
export const GEOCODING_TIMEOUT_MS = 5_000;

/**
 * Rows requested from the provider. More than MAX_CANDIDATES, so that a record
 * dropped as unusable or duplicate does not hide a valid fifth candidate.
 */
export const GEOCODING_REQUEST_COUNT = 10;
