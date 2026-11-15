import type { ActivityScores } from '../activity/activity.types';
import type { ForecastWeather, NormalizedForecast, SourceResult } from '../forecast/forecast.types';
import type { Location, LocationResolution } from '../location/location.types';
import { ATTRIBUTION } from './activity-forecast.constants';
import type { ActivityForecast, ForecastResult, SourceStatus } from './activity-forecast.types';

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
