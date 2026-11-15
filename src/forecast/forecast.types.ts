import type { ForecastWindow } from '../calendar/calendar.types';
import type { Location } from '../location/location.types';
import type { SourceFailureCode } from './forecast.errors';

/**
 * The two Open-Meteo forecast APIs. Values match the `weather_source` database
 * enum and the GraphQL `WeatherSource` enum in the Technical Design.
 */
export type WeatherSource = 'ATMOSPHERIC' | 'MARINE';

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

export interface SourceFailure {
  code: SourceFailureCode;
  /** Client-facing explanation, free of provider text. */
  reason: string;
}

/**
 * One source's outcome for a request, matching the GraphQL `SourceStatus`:
 * FRESH and STALE carry the snapshot they reuse, STALE and UNAVAILABLE the
 * refresh failure. A fresh snapshot can still hold null measurements.
 */
export type SourceResult =
  | { source: WeatherSource; freshness: 'FRESH'; snapshot: WeatherSnapshot }
  | { source: WeatherSource; freshness: 'STALE'; snapshot: WeatherSnapshot; failure: SourceFailure }
  | { source: WeatherSource; freshness: 'UNAVAILABLE'; failure: SourceFailure };

export interface ForecastWeather {
  window: ForecastWindow;
  atmospheric: SourceResult;
  marine: SourceResult;
}

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
