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

/** Most candidates a city search exposes (SPEC-01). */
export const MAX_CANDIDATES = 5;
