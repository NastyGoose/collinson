import type { ActivityRanking, ActivityScores } from '../activities/activity';
import type { SourceFailureCode } from '../forecasts/forecast.errors';
import type { ForecastWeather, SourceResult } from '../forecasts/forecasts.service';
import type { NormalizedForecast, WeatherSource } from '../forecasts/weather-source';
import type { Location } from '../locations/location';
import type { LocationResolution } from '../locations/locations.service';

/**
 * Credit for the data behind every forecast: weather and geocoding both come from
 * Open-Meteo, whose terms require CC BY 4.0 attribution.
 */
export const ATTRIBUTION =
  'Weather and location data by Open-Meteo.com (https://open-meteo.com/), licensed under CC BY 4.0.';

/** The GraphQL `SourceStatus` type. */
export interface SourceStatus {
  source: WeatherSource;
  freshness: SourceResult['freshness'];
  /** UTC ISO timestamp of the snapshot in use. */
  fetchedAt: string | null;
  failureCode: SourceFailureCode | null;
  reason: string | null;
}

/** The GraphQL `ActivityForecast` type. */
export interface ActivityForecast {
  __typename: 'ActivityForecast';
  location: Location;
  startDate: string;
  endDate: string;
  scoringVersion: string;
  activities: ActivityRanking[];
  sources: SourceStatus[];
  attribution: string;
}

/** The members of the GraphQL `ForecastResult` union, tagged with their type name. */
export type ForecastResult =
  | ActivityForecast
  | { __typename: 'AmbiguousLocation'; candidates: Location[] }
  | { __typename: 'LocationNotFound'; message: string };

/** The resolutions that end the request before any weather is read. */
export function toUnresolvedResult(
  resolution: Exclude<LocationResolution, { kind: 'resolved' }>,
): ForecastResult {
  return resolution.kind === 'ambiguous'
    ? { __typename: 'AmbiguousLocation', candidates: resolution.candidates }
    : { __typename: 'LocationNotFound', message: resolution.message };
}

/**
 * The forecast a source contributes to scoring. A stale snapshot is scored like a
 * fresh one; its freshness only shows in `SourceStatus`.
 */
export function scoringInputOf(result: SourceResult): NormalizedForecast | null {
  return result.freshness === 'UNAVAILABLE' ? null : result.snapshot;
}

/** Field rules from the Technical Design: fresh has no failure, unavailable no timestamp. */
export function toSourceStatus(result: SourceResult): SourceStatus {
  switch (result.freshness) {
    case 'FRESH':
      return {
        source: result.source,
        freshness: 'FRESH',
        fetchedAt: result.snapshot.fetchedAt.toISOString(),
        failureCode: null,
        reason: null,
      };
    case 'STALE':
      return {
        source: result.source,
        freshness: 'STALE',
        fetchedAt: result.snapshot.fetchedAt.toISOString(),
        failureCode: result.failure.code,
        reason: result.failure.reason,
      };
    case 'UNAVAILABLE':
      return {
        source: result.source,
        freshness: 'UNAVAILABLE',
        fetchedAt: null,
        failureCode: result.failure.code,
        reason: result.failure.reason,
      };
  }
}

/** `weather.window` is the frozen window both the sources and the scores were judged against. */
export function toActivityForecast(
  location: Location,
  weather: ForecastWeather,
  scores: ActivityScores,
): ActivityForecast {
  const { window } = weather;
  return {
    __typename: 'ActivityForecast',
    location,
    startDate: window.dates[0],
    endDate: window.dates[window.dates.length - 1],
    scoringVersion: scores.scoringVersion,
    activities: scores.activities,
    // Atmospheric then marine, as the contract fixes.
    sources: [toSourceStatus(weather.atmospheric), toSourceStatus(weather.marine)],
    attribution: ATTRIBUTION,
  };
}
