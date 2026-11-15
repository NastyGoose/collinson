import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { atmosphericBody, marineBody, PENICHE } from '../../fixtures/open-meteo-weather';
import { deferred } from '../../support/deferred';
import { rejected } from '../../support/errors';
import { FixedClock } from '../../support/fixed-clock';
import { Clock } from '../../../src/clock/clock';
import {
  ForecastStorageUnavailableError,
  SourceRefreshError,
} from '../../../src/forecasts/forecast.errors';
import { forecastWindow } from '../../../src/forecasts/forecast-window';
import { ForecastsRepository } from '../../../src/forecasts/forecasts.repository';
import {
  FRESH_FOR_MS,
  ForecastsService,
  STALE_FALLBACK_MS,
} from '../../../src/forecasts/forecasts.service';
import {
  ATMOSPHERIC_SPEC,
  OpenMeteoAtmosphericClient,
} from '../../../src/forecasts/open-meteo-atmospheric.client';
import {
  parseForecastResponse,
  type ForecastLocation,
} from '../../../src/forecasts/open-meteo-forecast';
import {
  MARINE_SPEC,
  OpenMeteoMarineClient,
} from '../../../src/forecasts/open-meteo-marine.client';
import type {
  NormalizedForecast,
  WeatherSnapshot,
  WeatherSource,
} from '../../../src/forecasts/weather-source';

const NOON = '2026-11-14T12:00:00.000Z';
/** Lisbon is UTC+0 in November: the provider's "today" starts at 00:00 UTC. */
const TODAY = '2026-11-14T00:00:00Z';
const TOMORROW = '2026-11-15T00:00:00Z';
const HOUR_MS = 60 * 60 * 1000;

function atmospheric(firstHour = TODAY, hours?: number): NormalizedForecast {
  return parseForecastResponse(atmosphericBody({ firstHour, hours }), ATMOSPHERIC_SPEC, PENICHE);
}

function marine(firstHour = TODAY, waves: 'complete' | 'null' = 'complete'): NormalizedForecast {
  return parseForecastResponse(marineBody({ firstHour, waves }), MARINE_SPEC, PENICHE);
}

function snapshot(forecast: NormalizedForecast, fetchedAt: string): WeatherSnapshot {
  return { ...forecast, locationId: PENICHE.id, fetchedAt: new Date(fetchedAt) };
}

async function createService() {
  const clock = new FixedClock(NOON);
  // One location per test: rows are keyed by source, and reads check the rest of the key.
  const rows = new Map<WeatherSource, WeatherSnapshot>();
  const repository: jest.Mocked<Pick<ForecastsRepository, 'findSnapshot' | 'saveSnapshot'>> = {
    findSnapshot: jest.fn((locationId: string, source: WeatherSource, schemaVersion: number) => {
      const row = rows.get(source);
      const matches = row?.locationId === locationId && row.schemaVersion === schemaVersion;
      return Promise.resolve(matches ? row : null);
    }),
    saveSnapshot: jest.fn((row: WeatherSnapshot) => {
      rows.set(row.source, row);
      return Promise.resolve();
    }),
  };
  const atmosphericClient: jest.Mocked<Pick<OpenMeteoAtmosphericClient, 'spec' | 'fetchForecast'>> =
    {
      spec: ATMOSPHERIC_SPEC,
      fetchForecast: jest.fn((_location: ForecastLocation) => Promise.resolve(atmospheric())),
    };
  const marineClient: jest.Mocked<Pick<OpenMeteoMarineClient, 'spec' | 'fetchForecast'>> = {
    spec: MARINE_SPEC,
    fetchForecast: jest.fn((_location: ForecastLocation) => Promise.resolve(marine())),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      ForecastsService,
      { provide: ForecastsRepository, useValue: repository },
      { provide: OpenMeteoAtmosphericClient, useValue: atmosphericClient },
      { provide: OpenMeteoMarineClient, useValue: marineClient },
      { provide: Clock, useValue: clock },
    ],
  }).compile();
  const service = moduleRef.get(ForecastsService);
  const window = () => forecastWindow(clock.now(), PENICHE.timezone);
  return { service, clock, rows, repository, atmosphericClient, marineClient, window };
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('ForecastsService reuse', () => {
  it('fetches, stores and returns both sources on a cold request', async () => {
    const { service, repository, window } = await createService();

    const weather = await service.getWeather(PENICHE, window());

    expect(weather.atmospheric).toMatchObject({ source: 'ATMOSPHERIC', freshness: 'FRESH' });
    expect(weather.marine).toMatchObject({ source: 'MARINE', freshness: 'FRESH' });
    expect(repository.saveSnapshot).toHaveBeenCalledTimes(2);
    expect(repository.saveSnapshot.mock.calls[0][0].fetchedAt).toEqual(new Date(NOON));
  });

  it('reuses a coverage-complete snapshot just under six hours old', async () => {
    const { service, clock, rows, atmosphericClient, window } = await createService();
    rows.set('ATMOSPHERIC', snapshot(atmospheric(), NOON));
    clock.advance(FRESH_FOR_MS - 1);

    const weather = await service.getWeather(PENICHE, window());

    expect(weather.atmospheric.freshness).toBe('FRESH');
    expect(atmosphericClient.fetchForecast).not.toHaveBeenCalled();
  });

  it('refreshes a snapshot at six hours old', async () => {
    const { service, clock, rows, atmosphericClient, window } = await createService();
    rows.set('ATMOSPHERIC', snapshot(atmospheric(), NOON));
    clock.advance(FRESH_FOR_MS);

    await service.getWeather(PENICHE, window());

    expect(atmosphericClient.fetchForecast).toHaveBeenCalledTimes(1);
  });

  it('refreshes a recent snapshot that misses the window, whatever its age', async () => {
    const { service, clock, rows, atmosphericClient, window } = await createService();
    rows.set('ATMOSPHERIC', snapshot(atmospheric(), '2026-11-14T23:30:00Z'));
    clock.set('2026-11-15T00:30:00Z'); // one hour later, but the window now ends on the 22nd
    atmosphericClient.fetchForecast.mockResolvedValue(atmospheric(TOMORROW));

    const weather = await service.getWeather(PENICHE, window());

    expect(atmosphericClient.fetchForecast).toHaveBeenCalledTimes(1);
    expect(weather.atmospheric.freshness).toBe('FRESH');
  });

  it('reuses a fresh all-null marine snapshot without a refresh', async () => {
    const { service, rows, marineClient, window } = await createService();
    rows.set('MARINE', snapshot(marine(TODAY, 'null'), NOON));

    const weather = await service.getWeather(PENICHE, window());

    expect(weather.marine.freshness).toBe('FRESH');
    expect(marineClient.fetchForecast).not.toHaveBeenCalled();
  });

  it('does not trust a snapshot dated in the future as fresh', async () => {
    const { service, rows, atmosphericClient, window } = await createService();
    rows.set('ATMOSPHERIC', snapshot(atmospheric(), '2026-11-14T13:00:00Z'));

    await service.getWeather(PENICHE, window());

    expect(atmosphericClient.fetchForecast).toHaveBeenCalledTimes(1);
  });

  it('ignores a stored snapshot of another schema version', async () => {
    const { service, rows, atmosphericClient, window } = await createService();
    rows.set('ATMOSPHERIC', { ...snapshot(atmospheric(), NOON), schemaVersion: 0 });

    await service.getWeather(PENICHE, window());

    expect(atmosphericClient.fetchForecast).toHaveBeenCalledTimes(1);
  });

  it('reuses a snapshot another refresh stored after the caller read, without fetching', async () => {
    const { service, repository, atmosphericClient, window } = await createService();
    const justStored = snapshot(atmospheric(), NOON);
    // The caller's read predates the other refresh; the refresh's own read sees its row.
    let atmosphericReads = 0;
    repository.findSnapshot.mockImplementation((_id, source) => {
      if (source !== 'ATMOSPHERIC') {
        return Promise.resolve(null);
      }
      atmosphericReads += 1;
      return Promise.resolve(atmosphericReads === 1 ? null : justStored);
    });

    const weather = await service.getWeather(PENICHE, window());

    expect(atmosphericClient.fetchForecast).not.toHaveBeenCalled();
    expect(weather.atmospheric).toEqual({
      source: 'ATMOSPHERIC',
      freshness: 'FRESH',
      snapshot: justStored,
    });
  });

  it('rejects a window in another time zone than the location', async () => {
    const { service } = await createService();

    await expect(
      service.getWeather(PENICHE, forecastWindow(new Date(NOON), 'Europe/Warsaw')),
    ).rejects.toThrow('Europe/Warsaw');
  });
});

describe('ForecastsService refresh failures', () => {
  const timeout = new SourceRefreshError(
    'TIMEOUT',
    'Marine forecast did not answer within 5000 ms.',
  );

  // Age alone is under test here: the stored range is kept covering the window.
  const fetchedAgo = (ms: number) => new Date(Date.parse(NOON) - ms).toISOString();

  it('serves a coverage-complete snapshot exactly 24 hours old as stale with the failure', async () => {
    const { service, rows, marineClient, window } = await createService();
    const stored = snapshot(marine(), fetchedAgo(STALE_FALLBACK_MS));
    rows.set('MARINE', stored);
    marineClient.fetchForecast.mockRejectedValue(timeout);

    const weather = await service.getWeather(PENICHE, window());

    expect(weather.marine).toEqual({
      source: 'MARINE',
      freshness: 'STALE',
      snapshot: stored,
      failure: { code: 'TIMEOUT', reason: 'Marine forecast did not answer within 5000 ms.' },
    });
    expect(weather.atmospheric.freshness).toBe('FRESH');
  });

  it('reports the source unavailable once the snapshot is over 24 hours old', async () => {
    const { service, rows, marineClient, window } = await createService();
    rows.set('MARINE', snapshot(marine(), fetchedAgo(STALE_FALLBACK_MS + 1)));
    marineClient.fetchForecast.mockRejectedValue(timeout);

    const weather = await service.getWeather(PENICHE, window());

    expect(weather.marine).toEqual({
      source: 'MARINE',
      freshness: 'UNAVAILABLE',
      failure: { code: 'TIMEOUT', reason: timeout.message },
    });
  });

  it('reports the source unavailable when the recent snapshot misses the window', async () => {
    const { service, clock, rows, marineClient, window } = await createService();
    rows.set('MARINE', snapshot(marine(), '2026-11-14T23:30:00Z'));
    clock.set('2026-11-15T00:30:00Z');
    marineClient.fetchForecast.mockRejectedValue(timeout);

    const weather = await service.getWeather(PENICHE, window());

    expect(weather.marine).toMatchObject({
      freshness: 'UNAVAILABLE',
      failure: { code: 'TIMEOUT' },
    });
  });

  it('reports the source unavailable when no snapshot exists', async () => {
    const { service, marineClient, window } = await createService();
    marineClient.fetchForecast.mockRejectedValue(
      new SourceRefreshError('RATE_LIMITED', 'Marine forecast rate limit reached (HTTP 429).'),
    );

    const weather = await service.getWeather(PENICHE, window());

    expect(weather.marine).toMatchObject({
      freshness: 'UNAVAILABLE',
      failure: { code: 'RATE_LIMITED' },
    });
    expect(weather.atmospheric.freshness).toBe('FRESH');
  });

  it('never stores a refresh that misses the window, and falls back to the previous one', async () => {
    const { service, clock, rows, repository, atmosphericClient, window } = await createService();
    const stored = snapshot(atmospheric(), NOON);
    rows.set('ATMOSPHERIC', stored);
    clock.advance(7 * HOUR_MS);
    atmosphericClient.fetchForecast.mockResolvedValue(atmospheric(TODAY, 6 * 24));

    const weather = await service.getWeather(PENICHE, window());

    expect(weather.atmospheric).toMatchObject({
      freshness: 'STALE',
      snapshot: stored,
      failure: { code: 'INSUFFICIENT_COVERAGE' },
    });
    expect(repository.saveSnapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ATMOSPHERIC' }),
    );
    expect(rows.get('ATMOSPHERIC')).toBe(stored);
  });

  it('propagates a storage failure and lets the next request refresh again', async () => {
    const { service, repository, atmosphericClient, window } = await createService();
    repository.saveSnapshot.mockRejectedValueOnce(
      new ForecastStorageUnavailableError('Could not save a forecast snapshot.'),
    );

    await rejected(service.getWeather(PENICHE, window()), ForecastStorageUnavailableError);
    await service.getWeather(PENICHE, window());

    expect(atmosphericClient.fetchForecast).toHaveBeenCalledTimes(2);
  });
});

describe('ForecastsService coalescing', () => {
  it('shares one fetch per source between simultaneous misses', async () => {
    const { service, atmosphericClient, marineClient, window } = await createService();
    const answer = deferred<NormalizedForecast>();
    atmosphericClient.fetchForecast.mockReturnValue(answer.promise);

    const requests = [1, 2, 3].map(() => service.getWeather(PENICHE, window()));
    await flush();
    answer.resolve(atmospheric());
    const results = await Promise.all(requests);

    expect(atmosphericClient.fetchForecast).toHaveBeenCalledTimes(1);
    expect(marineClient.fetchForecast).toHaveBeenCalledTimes(1);
    expect(results.every((weather) => weather.atmospheric.freshness === 'FRESH')).toBe(true);
  });

  it('gives a caller that joined an older window one follow-up refresh for its own', async () => {
    const { service, clock, atmosphericClient } = await createService();
    const beforeMidnight = deferred<NormalizedForecast>();
    atmosphericClient.fetchForecast
      .mockReturnValueOnce(beforeMidnight.promise)
      .mockResolvedValueOnce(atmospheric(TOMORROW));

    clock.set('2026-11-14T23:59:00Z');
    const oldWindow = forecastWindow(clock.now(), PENICHE.timezone);
    const first = service.getWeather(PENICHE, oldWindow);
    clock.set('2026-11-15T00:01:00Z');
    const newWindow = forecastWindow(clock.now(), PENICHE.timezone);
    const second = service.getWeather(PENICHE, newWindow);
    await flush();
    beforeMidnight.resolve(atmospheric(TODAY));

    const [early, late] = await Promise.all([first, second]);

    expect(atmosphericClient.fetchForecast).toHaveBeenCalledTimes(2);
    expect(early.atmospheric).toMatchObject({ freshness: 'FRESH' });
    expect(late.atmospheric).toMatchObject({ freshness: 'FRESH' });
    expect(
      late.atmospheric.freshness === 'FRESH' && late.atmospheric.snapshot.coverageStart,
    ).toEqual(new Date(TOMORROW));
  });

  it('gives that caller only one follow-up before falling back', async () => {
    const { service, clock, atmosphericClient } = await createService();
    const beforeMidnight = deferred<NormalizedForecast>();
    atmosphericClient.fetchForecast
      .mockReturnValueOnce(beforeMidnight.promise)
      .mockResolvedValue(atmospheric(TODAY)); // the provider keeps serving yesterday's range

    clock.set('2026-11-14T23:59:00Z');
    const first = service.getWeather(PENICHE, forecastWindow(clock.now(), PENICHE.timezone));
    clock.set('2026-11-15T00:01:00Z');
    const second = service.getWeather(PENICHE, forecastWindow(clock.now(), PENICHE.timezone));
    await flush();
    beforeMidnight.resolve(atmospheric(TODAY));
    const [, late] = await Promise.all([first, second]);

    expect(atmosphericClient.fetchForecast).toHaveBeenCalledTimes(2);
    expect(late.atmospheric).toMatchObject({
      freshness: 'UNAVAILABLE',
      failure: { code: 'INSUFFICIENT_COVERAGE' },
    });
  });

  it('skips the follow-up when the joined refresh failed for a reason other than coverage', async () => {
    const { service, clock, atmosphericClient } = await createService();
    const beforeMidnight = deferred<NormalizedForecast>();
    atmosphericClient.fetchForecast.mockReturnValueOnce(beforeMidnight.promise);

    clock.set('2026-11-14T23:59:00Z');
    const first = service.getWeather(PENICHE, forecastWindow(clock.now(), PENICHE.timezone));
    clock.set('2026-11-15T00:01:00Z');
    const second = service.getWeather(PENICHE, forecastWindow(clock.now(), PENICHE.timezone));
    await flush();
    // A follow-up would reach the default mock and succeed, so a second call shows up.
    beforeMidnight.reject(
      new SourceRefreshError('RATE_LIMITED', 'Atmospheric forecast rate limit reached (HTTP 429).'),
    );
    const [, late] = await Promise.all([first, second]);

    expect(atmosphericClient.fetchForecast).toHaveBeenCalledTimes(1);
    expect(late.atmospheric).toMatchObject({
      freshness: 'UNAVAILABLE',
      failure: { code: 'RATE_LIMITED' },
    });
  });

  it('does not repeat a failed refresh for a caller with the same window', async () => {
    const { service, atmosphericClient, window } = await createService();
    const answer = deferred<NormalizedForecast>();
    atmosphericClient.fetchForecast.mockReturnValue(answer.promise);

    const requests = [service.getWeather(PENICHE, window()), service.getWeather(PENICHE, window())];
    await flush();
    answer.resolve(atmospheric(TODAY, 24));
    const results = await Promise.all(requests);

    expect(atmosphericClient.fetchForecast).toHaveBeenCalledTimes(1);
    expect(results.map((weather) => weather.atmospheric.freshness)).toEqual([
      'UNAVAILABLE',
      'UNAVAILABLE',
    ]);
  });
});

/** Lets pending repository reads settle so every caller reaches the refresh. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await Promise.resolve();
  }
}
