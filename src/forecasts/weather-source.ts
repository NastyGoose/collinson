/**
 * The two Open-Meteo forecast APIs. Values match the `weather_source` database
 * enum and the GraphQL `WeatherSource` enum in the Technical Design.
 */
export type WeatherSource = 'ATMOSPHERIC' | 'MARINE';

export const WEATHER_SOURCES: readonly WeatherSource[] = ['ATMOSPHERIC', 'MARINE'];

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Hourly measurements in provider order. `time` holds Unix seconds, strictly
 * increasing; each series is aligned with it and keeps the provider's nulls.
 */
export interface HourlySeries {
  time: number[];
  series: Record<string, (number | null)[]>;
}

/** A validated provider answer, normalized but not yet checked against a date window. */
export interface NormalizedForecast {
  source: WeatherSource;
  schemaVersion: number;
  requested: Coordinates;
  /** The model grid point the provider answered for. */
  returned: Coordinates;
  /** IANA time zone requested and used to bucket the hourly instants. */
  timezone: string;
  /** Provider unit per variable. */
  units: Record<string, string>;
  hourly: HourlySeries;
  /** First and last hourly instants. */
  coverageStart: Date;
  coverageEnd: Date;
}

/** A stored snapshot: a normalized forecast for a location and when it was fetched. */
export interface WeatherSnapshot extends NormalizedForecast {
  locationId: string;
  fetchedAt: Date;
}
