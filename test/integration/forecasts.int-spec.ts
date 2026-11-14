import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { Clock } from '../../src/clock/clock';
import { ClockModule } from '../../src/clock/clock.module';
import { validateEnv } from '../../src/config/env';
import { forecastWindow } from '../../src/forecasts/forecast-window';
import { ForecastsModule } from '../../src/forecasts/forecasts.module';
import { ForecastsRepository } from '../../src/forecasts/forecasts.repository';
import { ForecastsService, type ForecastWeather } from '../../src/forecasts/forecasts.service';
import { HTTP_FETCH, type HttpFetch } from '../../src/http/http-fetch';
import type { Location } from '../../src/locations/location';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  atmosphericBody,
  clonePayload,
  marineBody,
  PENICHE,
  WARSAW,
} from '../fixtures/open-meteo-weather';
import { FixedClock } from '../support/fixed-clock';
import { fixtureFetch, jsonResponse, timeoutError } from '../support/fixture-fetch';

const NOON = '2026-11-14T12:00:00.000Z';
/** Peniche (Europe/Lisbon) is UTC+0 in November: its "today" starts at 00:00 UTC. */
const PENICHE_TODAY = '2026-11-14T00:00:00Z';
/** Warsaw is UTC+1: local midnight of the 14th and the 15th in UTC. */
const WARSAW_14TH = '2026-11-13T23:00:00Z';
const WARSAW_15TH = '2026-11-14T23:00:00Z';
const HOUR_MS = 60 * 60 * 1000;

type Answer = () => Response | Promise<Response>;

/** Fixture Open-Meteo: one swappable answer per API, with every call counted. */
class FakeOpenMeteo {
  atmospheric: Answer = () => jsonResponse(atmosphericBody({ firstHour: PENICHE_TODAY }));
  marine: Answer = () => jsonResponse(marineBody({ firstHour: PENICHE_TODAY }));
  readonly calls = { atmospheric: 0, marine: 0 };
  readonly fetch = fixtureFetch((url) => {
    if (url.hostname === 'api.open-meteo.com') {
      this.calls.atmospheric += 1;
      return this.atmospheric();
    }
    if (url.hostname === 'marine-api.open-meteo.com') {
      this.calls.marine += 1;
      return this.marine();
    }
    throw new Error(`no fixture for ${url.toString()}`);
  });
}

/** Answers that complete only when the test opens the gate. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

interface SnapshotRow {
  location_id: string;
  source: string;
  schema_version: number;
  fetched_at: Date;
  coverage_start: Date;
  coverage_end: Date;
  requested_latitude: number;
  requested_longitude: number;
  returned_latitude: number;
  returned_longitude: number;
  timezone: string;
  units: Record<string, string>;
  hourly: { time: number[]; series: Record<string, (number | null)[]> };
  created_at: Date;
  updated_at: Date;
}

describe('ForecastsService with PostgreSQL', () => {
  const clock = new FixedClock(NOON);
  let provider = new FakeOpenMeteo();
  let moduleRef: TestingModule;
  let service: ForecastsService;
  let prisma: PrismaService;

  async function createModule(): Promise<TestingModule> {
    const testingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        PrismaModule,
        ClockModule,
        ForecastsModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .overrideProvider(HTTP_FETCH)
      // Delegate, so each test can swap the fixture behind the same provider.
      .useValue((...args: Parameters<HttpFetch>) => provider.fetch(...args))
      .compile();
    return testingModule.init();
  }

  function weatherFor(location: Location, service_ = service): Promise<ForecastWeather> {
    return service_.getWeather(location, forecastWindow(clock.now(), location.timezone));
  }

  async function snapshotRows(): Promise<SnapshotRow[]> {
    return prisma.$queryRaw<SnapshotRow[]>`
      SELECT * FROM forecast_snapshots ORDER BY location_id, source`;
  }

  async function storeLocation(location: Location): Promise<void> {
    await prisma.location.create({ data: location });
  }

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    moduleRef = await createModule();
    service = moduleRef.get(ForecastsService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef.close();
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE forecast_snapshots, location_search_results, location_searches, locations`;
    await storeLocation(PENICHE);
    await storeLocation(WARSAW);
    clock.set(NOON);
    provider = new FakeOpenMeteo();
  });

  describe('cold and warm requests', () => {
    it('fetches each source once and persists normalized weather with its metadata', async () => {
      const weather = await weatherFor(PENICHE);

      expect(weather.atmospheric.freshness).toBe('FRESH');
      expect(weather.marine.freshness).toBe('FRESH');
      expect(provider.calls).toEqual({ atmospheric: 1, marine: 1 });
      const rows = await snapshotRows();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        location_id: PENICHE.id,
        source: 'ATMOSPHERIC',
        schema_version: 1,
        fetched_at: new Date(NOON),
        coverage_start: new Date(PENICHE_TODAY),
        coverage_end: new Date('2026-11-21T23:00:00Z'),
        requested_latitude: PENICHE.latitude,
        requested_longitude: PENICHE.longitude,
        returned_latitude: 39.371773,
        returned_longitude: -9.33009,
        timezone: 'Europe/Lisbon',
        units: {
          temperature_2m: '°C',
          snow_depth: 'm',
          precipitation: 'mm',
          wind_speed_10m: 'km/h',
        },
      });
      expect(rows[0].hourly.time).toHaveLength(192);
      // JSONB orders object keys by itself; the variable set is what matters.
      expect(Object.keys(rows[0].hourly.series).sort()).toEqual([
        'precipitation',
        'snow_depth',
        'temperature_2m',
        'wind_speed_10m',
      ]);
      expect(rows[1]).toMatchObject({
        source: 'MARINE',
        units: { wave_height: 'm', wave_period: 's' },
      });
    });

    it('reuses fresh snapshots on a second request with zero upstream calls', async () => {
      const first = await weatherFor(PENICHE);
      clock.advance(5 * HOUR_MS);

      const second = await weatherFor(PENICHE);

      expect(provider.calls).toEqual({ atmospheric: 1, marine: 1 });
      expect(second).toEqual(first);
    });

    it('reuses stored snapshots after an application restart', async () => {
      const first = await weatherFor(PENICHE);
      await moduleRef.close();
      moduleRef = await createModule();
      service = moduleRef.get(ForecastsService);
      prisma = moduleRef.get(PrismaService);

      const afterRestart = await weatherFor(PENICHE);

      expect(provider.calls).toEqual({ atmospheric: 1, marine: 1 });
      expect(afterRestart).toEqual(first);
    });

    it('replaces each snapshot in place once it is six hours old', async () => {
      await weatherFor(PENICHE);
      const [before] = await snapshotRows();
      clock.advance(6 * HOUR_MS);

      const weather = await weatherFor(PENICHE);

      expect(provider.calls).toEqual({ atmospheric: 2, marine: 2 });
      expect(weather.atmospheric.freshness).toBe('FRESH');
      const rows = await snapshotRows();
      expect(rows).toHaveLength(2);
      expect(rows[0].fetched_at).toEqual(new Date(Date.parse(NOON) + 6 * HOUR_MS));
      expect(rows[0].created_at).toEqual(before.created_at);
    });

    it('stores and reuses a timestamp-complete marine snapshot whose waves are all null', async () => {
      provider.atmospheric = () =>
        jsonResponse(atmosphericBody({ firstHour: WARSAW_14TH, timezone: 'Europe/Warsaw' }));
      provider.marine = () =>
        jsonResponse(
          marineBody({ firstHour: WARSAW_14TH, timezone: 'Europe/Warsaw', waves: 'null' }),
        );

      const first = await weatherFor(WARSAW);
      const second = await weatherFor(WARSAW);

      expect(first.marine.freshness).toBe('FRESH');
      expect(second.marine.freshness).toBe('FRESH');
      expect(provider.calls.marine).toBe(1);
      const marineRow = (await snapshotRows()).find((row) => row.source === 'MARINE');
      expect(marineRow?.hourly.series.wave_height.every((value) => value === null)).toBe(true);
      expect(marineRow?.hourly.series.wave_period).toHaveLength(192);
    });
  });

  describe('concurrent requests', () => {
    it('issues one fetch per source for simultaneous misses', async () => {
      const held = gate();
      provider.atmospheric = async () => {
        await held.opened;
        return jsonResponse(atmosphericBody({ firstHour: PENICHE_TODAY }));
      };
      const reads = jest.spyOn(moduleRef.get(ForecastsRepository), 'findSnapshot');

      const requests = Array.from({ length: 5 }, () => weatherFor(PENICHE));
      await allCallersPastTheirRead(reads, 10);
      held.open();
      const results = await Promise.all(requests);

      expect(provider.calls).toEqual({ atmospheric: 1, marine: 1 });
      expect(results.every((weather) => weather.atmospheric.freshness === 'FRESH')).toBe(true);
      reads.mockRestore();
    });
  });

  describe('local midnight rollover', () => {
    it('refreshes a one-hour-old snapshot once the new date window is uncovered', async () => {
      provider.atmospheric = () =>
        jsonResponse(atmosphericBody({ firstHour: WARSAW_14TH, timezone: 'Europe/Warsaw' }));
      provider.marine = () =>
        jsonResponse(marineBody({ firstHour: WARSAW_14TH, timezone: 'Europe/Warsaw' }));
      clock.set('2026-11-14T22:30:00Z'); // 23:30 in Warsaw
      await weatherFor(WARSAW);

      clock.set('2026-11-14T23:30:00Z'); // 00:30 on the 15th in Warsaw
      provider.atmospheric = () =>
        jsonResponse(atmosphericBody({ firstHour: WARSAW_15TH, timezone: 'Europe/Warsaw' }));
      provider.marine = () =>
        jsonResponse(marineBody({ firstHour: WARSAW_15TH, timezone: 'Europe/Warsaw' }));
      const weather = await weatherFor(WARSAW);

      expect(weather.window.dates[0]).toBe('2026-11-16');
      expect(provider.calls).toEqual({ atmospheric: 2, marine: 2 });
      expect(weather.atmospheric.freshness).toBe('FRESH');
      const rows = await snapshotRows();
      expect(rows.map((row) => row.coverage_start)).toEqual([
        new Date(WARSAW_15TH),
        new Date(WARSAW_15TH),
      ]);
    });

    it('gives a caller after midnight one follow-up refresh when it joined an earlier window', async () => {
      const held = gate();
      let attempt = 0;
      provider.atmospheric = async () => {
        attempt += 1;
        if (attempt === 1) {
          await held.opened;
          return jsonResponse(
            atmosphericBody({ firstHour: WARSAW_14TH, timezone: 'Europe/Warsaw' }),
          );
        }
        return jsonResponse(atmosphericBody({ firstHour: WARSAW_15TH, timezone: 'Europe/Warsaw' }));
      };
      provider.marine = () =>
        jsonResponse(marineBody({ firstHour: WARSAW_15TH, timezone: 'Europe/Warsaw' }));
      const reads = jest.spyOn(moduleRef.get(ForecastsRepository), 'findSnapshot');

      clock.set('2026-11-14T22:59:00Z'); // 23:59 in Warsaw: window 15th–21st
      const beforeMidnight = weatherFor(WARSAW);
      await allCallersPastTheirRead(reads, 2);
      clock.set('2026-11-14T23:01:00Z'); // 00:01 on the 15th: window 16th–22nd
      const afterMidnight = weatherFor(WARSAW);
      await allCallersPastTheirRead(reads, 4);
      held.open();
      const [early, late] = await Promise.all([beforeMidnight, afterMidnight]);

      expect(provider.calls.atmospheric).toBe(2);
      expect(early.window.dates[0]).toBe('2026-11-15');
      expect(early.atmospheric.freshness).toBe('FRESH');
      expect(late.window.dates[0]).toBe('2026-11-16');
      expect(late.atmospheric.freshness).toBe('FRESH');
      const atmosphericRow = (await snapshotRows()).find((row) => row.source === 'ATMOSPHERIC');
      expect(atmosphericRow?.coverage_start).toEqual(new Date(WARSAW_15TH));
      reads.mockRestore();
    });
  });

  describe('refresh failures', () => {
    it('serves the previous snapshot as stale with the failure, retrying 5xx once', async () => {
      await weatherFor(PENICHE);
      clock.advance(7 * HOUR_MS);
      provider.atmospheric = () => jsonResponse({}, 503);
      provider.marine = () => jsonResponse({}, 429);

      const weather = await weatherFor(PENICHE);

      expect(provider.calls).toEqual({ atmospheric: 3, marine: 2 });
      expect(weather.atmospheric).toMatchObject({
        freshness: 'STALE',
        snapshot: { fetchedAt: new Date(NOON) },
        failure: { code: 'UPSTREAM_FAILURE', reason: 'Atmospheric forecast answered HTTP 503.' },
      });
      expect(weather.marine).toMatchObject({
        freshness: 'STALE',
        snapshot: { fetchedAt: new Date(NOON) },
        failure: { code: 'RATE_LIMITED' },
      });
    });

    it('reports a source unavailable when no coverage-complete snapshot is young enough', async () => {
      await weatherFor(PENICHE);
      clock.advance(25 * HOUR_MS);
      provider.marine = () => {
        throw timeoutError();
      };

      const weather = await weatherFor(PENICHE);

      expect(weather.marine).toEqual({
        source: 'MARINE',
        freshness: 'UNAVAILABLE',
        failure: { code: 'TIMEOUT', reason: 'Marine forecast did not answer within 5000 ms.' },
      });
      expect(provider.calls.marine).toBe(3);
    });

    it('keeps atmospheric results when only the marine source fails on a cold request', async () => {
      provider.marine = () => {
        throw timeoutError();
      };

      const weather = await weatherFor(PENICHE);

      expect(weather.atmospheric.freshness).toBe('FRESH');
      expect(weather.marine).toMatchObject({
        freshness: 'UNAVAILABLE',
        failure: { code: 'TIMEOUT' },
      });
      expect((await snapshotRows()).map((row) => row.source)).toEqual(['ATMOSPHERIC']);
    });

    it.each([
      [
        'a malformed payload',
        'INVALID_PAYLOAD',
        () => {
          const body = clonePayload(atmosphericBody({ firstHour: PENICHE_TODAY }));
          body.hourly.precipitation.pop();
          return body;
        },
      ],
      [
        'wind in another unit',
        'INVALID_PAYLOAD',
        () => {
          const body = clonePayload(atmosphericBody({ firstHour: PENICHE_TODAY }));
          body.hourly_units.wind_speed_10m = 'mp/h';
          return body;
        },
      ],
      [
        'a timestamp-incomplete payload',
        'INSUFFICIENT_COVERAGE',
        () => atmosphericBody({ firstHour: PENICHE_TODAY, hours: 6 * 24 }),
      ],
    ])('preserves the previous snapshot after %s', async (_label, code, body) => {
      await weatherFor(PENICHE);
      const [before] = await snapshotRows();
      clock.advance(7 * HOUR_MS);
      provider.atmospheric = () => jsonResponse(body());

      const weather = await weatherFor(PENICHE);

      expect(provider.calls.atmospheric).toBe(2);
      expect(weather.atmospheric).toMatchObject({ freshness: 'STALE', failure: { code } });
      const [after] = await snapshotRows();
      expect(after).toEqual(before);
    });
  });
});

/**
 * Waits until `reads` has been called `count` times and every read has settled,
 * then one more macrotask, so each caller has joined or started its refresh.
 */
async function allCallersPastTheirRead(
  reads: jest.SpyInstance<Promise<unknown>>,
  count: number,
): Promise<void> {
  while (reads.mock.calls.length < count) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await Promise.all(reads.mock.results.map((result) => result.value as Promise<unknown>));
  await new Promise((resolve) => setImmediate(resolve));
}
