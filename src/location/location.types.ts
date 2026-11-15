/**
 * A resolved geographic identity. Field names follow the GraphQL `Location` type
 * in the Technical Design; `id` is the stable Open-Meteo geocoding ID as decimal text.
 */
export interface Location {
  id: string;
  name: string;
  country: string;
  region: string | null;
  latitude: number;
  longitude: number;
  /** IANA time zone name. */
  timezone: string;
}

/** A validated city search. */
export interface CitySearch {
  /**
   * The search as sent to the provider and used as the cache key: NFKC-normalized,
   * trimmed, whitespace runs collapsed and lowercased. Sending the key itself keeps
   * every input that shares a cache entry asking the provider the same question.
   */
  query: string;
  /** The city as given, trimmed and NFC-normalized, for messages. */
  label: string;
  /** Uppercase ISO 3166-1 alpha-2 filter, or null for no filter. */
  countryCode: string | null;
}

/** Exactly one of a city search or a stored location ID. */
export type LocationSelector =
  { kind: 'city'; search: CitySearch } | { kind: 'id'; locationId: string };

/** The raw selector fields, as they arrive from GraphQL (absent fields may be null). */
export interface LocationSelectorInput {
  city?: string | null;
  countryCode?: string | null;
  locationId?: string | null;
}

/** The outcome of resolving a selector, matching the GraphQL union in the Technical Design. */
export type LocationResolution =
  | { kind: 'resolved'; location: Location }
  | { kind: 'ambiguous'; candidates: Location[] }
  | { kind: 'not_found'; message: string };

/** A cached search as stored: its candidates in provider order (possibly none). */
export interface CachedSearch {
  candidates: Location[];
  fetchedAt: Date;
  expiresAt: Date;
}
