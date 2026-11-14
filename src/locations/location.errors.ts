/**
 * Errors the Locations module raises. `code` is the GraphQL `extensions.code` the
 * Technical Design assigns to each failure, so the GraphQL layer maps them 1:1.
 */
export type LocationErrorCode = 'BAD_USER_INPUT' | 'GEOCODING_UNAVAILABLE' | 'STORAGE_UNAVAILABLE';

export abstract class LocationError extends Error {
  abstract readonly code: LocationErrorCode;
}

/** The selector or one of its fields is invalid. Raised before any upstream or storage access. */
export class InvalidLocationInputError extends LocationError {
  readonly code = 'BAD_USER_INPUT';

  constructor(
    message: string,
    /** The input field at fault: city, countryCode or locationId, or null for the selector as a whole. */
    readonly field: 'city' | 'countryCode' | 'locationId' | null,
  ) {
    super(message);
    this.name = 'InvalidLocationInputError';
  }
}

export type GeocodingFailureKind =
  | 'TIMEOUT'
  | 'NETWORK'
  | 'UPSTREAM_FAILURE'
  | 'RATE_LIMITED'
  | 'INVALID_PAYLOAD'
  | 'UNUSABLE_RESULTS';

/**
 * Open-Meteo geocoding failed or answered with nothing usable. Distinct from a
 * genuine no-match, which is an empty candidate list, and never cached.
 */
export class GeocodingUnavailableError extends LocationError {
  readonly code = 'GEOCODING_UNAVAILABLE';
  /** True for a timeout, a network error or HTTP 5xx: a second attempt may succeed. */
  readonly transient: boolean;

  constructor(
    readonly kind: GeocodingFailureKind,
    message: string,
    options?: { cause?: unknown; transient?: boolean },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'GeocodingUnavailableError';
    this.transient = options?.transient ?? false;
  }
}

/** PostgreSQL could not serve the operation. */
export class StorageUnavailableError extends LocationError {
  readonly code = 'STORAGE_UNAVAILABLE';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageUnavailableError';
  }
}
