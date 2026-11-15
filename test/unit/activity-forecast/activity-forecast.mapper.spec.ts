import { PENICHE } from '../../fixtures/open-meteo-weather';
import { atmosphericForecast } from '../../fixtures/scoring-weather';
import { forecastWindow } from '../../../src/calendar/calendar.logic';
import type { SourceResult } from '../../../src/forecast/forecast.types';
import {
  scoringInputOf,
  toSourceStatus,
} from '../../../src/activity-forecast/activity-forecast.mapper';

const WINDOW = forecastWindow(new Date('2026-11-14T12:00:00Z'), PENICHE.timezone);
const SNAPSHOT = {
  ...atmosphericForecast(WINDOW),
  locationId: PENICHE.id,
  fetchedAt: new Date('2026-11-14T03:00:00Z'),
};
const FAILURE = { code: 'RATE_LIMITED', reason: 'Open-Meteo forecast is rate limiting.' } as const;

const FRESH: SourceResult = { source: 'ATMOSPHERIC', freshness: 'FRESH', snapshot: SNAPSHOT };
const STALE: SourceResult = {
  source: 'ATMOSPHERIC',
  freshness: 'STALE',
  snapshot: SNAPSHOT,
  failure: FAILURE,
};
const UNAVAILABLE: SourceResult = {
  source: 'MARINE',
  freshness: 'UNAVAILABLE',
  failure: FAILURE,
};

describe('toSourceStatus', () => {
  it('gives a fresh source its fetch time and no failure', () => {
    expect(toSourceStatus(FRESH)).toEqual({
      source: 'ATMOSPHERIC',
      freshness: 'FRESH',
      fetchedAt: '2026-11-14T03:00:00.000Z',
      failureCode: null,
      reason: null,
    });
  });

  it('gives a stale source the reused snapshot time and the refresh failure', () => {
    expect(toSourceStatus(STALE)).toEqual({
      source: 'ATMOSPHERIC',
      freshness: 'STALE',
      fetchedAt: '2026-11-14T03:00:00.000Z',
      failureCode: 'RATE_LIMITED',
      reason: FAILURE.reason,
    });
  });

  it('gives an unavailable source the failure and no fetch time', () => {
    expect(toSourceStatus(UNAVAILABLE)).toEqual({
      source: 'MARINE',
      freshness: 'UNAVAILABLE',
      fetchedAt: null,
      failureCode: 'RATE_LIMITED',
      reason: FAILURE.reason,
    });
  });
});

describe('scoringInputOf', () => {
  it('scores a stale snapshot like a fresh one and an unavailable source as missing', () => {
    expect(scoringInputOf(FRESH)).toBe(SNAPSHOT);
    expect(scoringInputOf(STALE)).toBe(SNAPSHOT);
    expect(scoringInputOf(UNAVAILABLE)).toBeNull();
  });
});
