import type { ActivityRanking } from '../activity/activity.types';
import type { SourceFailureCode } from '../forecast/forecast.errors';
import type { SourceResult, WeatherSource } from '../forecast/forecast.types';
import type { Location } from '../location/location.types';

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
