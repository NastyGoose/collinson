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
  WARSAW_OFFSET,
  type Payload,
} from '../fixtures/open-meteo-weather';
import { deferred } from '../support/deferred';
import { FixedClock } from '../support/fixed-clock';
import { fixtureFetch, jsonResponse, timeoutError } from '../support/fixture-fetch';
import { callsSettled } from '../support/settled';

const NOON = '2026-11-14T12:00:00.000Z';
/** Peniche (Europe/Lisbon) is UTC+0 in November: its "today" starts at 00:00 UTC. */
const PENICHE_TODAY = '2026-11-14T00:00:00Z';
/** Warsaw is UTC+1: local midnight of the 14th and the 15th in UTC. */
const WARSAW_14TH = '2026-11-13T23:00:00Z';
const WARSAW_15TH = '2026-11-14T23:00:00Z';
const HOUR_MS = 60 * 60 * 1000;

type Answer = () => Response | Promise<Response>;

/**
 * Fixture Open-Meteo: one swappable answer per API, with every call counted.
 * A request to any other host is recorded as a miss, which would otherwise look
 * like a network outage, and fails the test.
 */
class FakeOpenMeteo {
  atmospheric: Answer = () => jsonResponse(atmosphericBody({ firstHour: PENICHE_TODAY }));
  marine: Answer = () => jsonResponse(marineBody({ firstHour: PENICHE_TODAY }));
  readonly calls = { atmospheric: 0, marine: 0 };
  readonly misses: string[] = [];
  readonly fetch = fixtureFetch((url) => {
    if (url.hostname === 'api.open-meteo.com') {
      this.calls.atmospheric += 1;
      return this.atmospheric();
    }
    if (url.hostname === 'marine-api.open-meteo.com') {
      this.calls.marine += 1;
      return this.marine();
    }
    this.misses.push(url.toString());
    throw new Error(`no fixture for ${url.toString()}`);
  });
}

/** Payloads for Warsaw, which echo its zone and offset. */
const warsawAtmospheric = (firstHour: string) =>
  jsonResponse(atmosphericBody({ firstHour, ...WARSAW_OFFSET }));
const warsawMarine = (firstHour: string, waves: 'complete' | 'null' = 'complete') =>
  jsonResponse(marineBody({ firstHour, waves, ...WARSAW_OFFSET }));

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
  /** Spy on snapshot reads, for tests that wait until every caller has read. */
  let reads: jest.SpyInstance<Promise<unknown>> | undefined;

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
      SELECT * FROM forecast_snapshots ORDER BY location_id, source, schema_version`;
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

  afterEach(() => {
    reads?.mockRestore();
    reads = undefined;
    expect(provider.misses).toEqual([]);
  });

  function spyOnReads(): jest.SpyInstance<Promise<unknown>> {
    reads = jest.spyOn(moduleRef.get(ForecastsRepository), 'findSnapshot');
    return reads;
  }

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
      provider.atmospheric = () => warsawAtmospheric(WARSAW_14TH);
      provider.marine = () => warsawMarine(WARSAW_14TH, 'null');

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
      const held = deferred();
      provider.atmospheric = async () => {
        await held.promise;
        return jsonResponse(atmosphericBody({ firstHour: PENICHE_TODAY }));
      };
      const snapshotReads = spyOnReads();

      const requests = Array.from({ length: 5 }, () => weatherFor(PENICHE));
      // Five callers read both sources before any of them reaches a refresh.
      await callsSettled(snapshotReads, 10);
      held.resolve();
      const results = await Promise.all(requests);

      expect(provider.calls).toEqual({ atmospheric: 1, marine: 1 });
      expect(results.every((weather) => weather.atmospheric.freshness === 'FRESH')).toBe(true);
    });
  });

  describe('local midnight rollover', () => {
    it('refreshes a one-hour-old snapshot once the new date window is uncovered', async () => {
      provider.atmospheric = () => warsawAtmospheric(WARSAW_14TH);
      provider.marine = () => warsawMarine(WARSAW_14TH);
      clock.set('2026-11-14T22:30:00Z'); // 23:30 in Warsaw
      await weatherFor(WARSAW);

      clock.set('2026-11-14T23:30:00Z'); // 00:30 on the 15th in Warsaw
      provider.atmospheric = () => warsawAtmospheric(WARSAW_15TH);
      provider.marine = () => warsawMarine(WARSAW_15TH);
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
      const held = deferred();
      let attempt = 0;
      provider.atmospheric = async () => {
        attempt += 1;
        if (attempt === 1) {
          await held.promise;
          return warsawAtmospheric(WARSAW_14TH);
        }
        return warsawAtmospheric(WARSAW_15TH);
      };
      provider.marine = () => warsawMarine(WARSAW_15TH);
      const snapshotReads = spyOnReads();

      clock.set('2026-11-14T22:59:00Z'); // 23:59 in Warsaw: window 15th–21st
      const beforeMidnight = weatherFor(WARSAW);
      await callsSettled(snapshotReads, 2);
      clock.set('2026-11-14T23:01:00Z'); // 00:01 on the 15th: window 16th–22nd
      // Counted from here: the first caller's refreshes also read the stored rows.
      const readsBefore = snapshotReads.mock.calls.length;
      const afterMidnight = weatherFor(WARSAW);
      await callsSettled(snapshotReads, readsBefore + 2);
      held.resolve();
      const [early, late] = await Promise.all([beforeMidnight, afterMidnight]);

      expect(provider.calls.atmospheric).toBe(2);
      expect(early.window.dates[0]).toBe('2026-11-15');
      expect(early.atmospheric.freshness).toBe('FRESH');
      expect(late.window.dates[0]).toBe('2026-11-16');
      expect(late.atmospheric.freshness).toBe('FRESH');
      const atmosphericRow = (await snapshotRows()).find((row) => row.source === 'ATMOSPHERIC');
      expect(atmosphericRow?.coverage_start).toEqual(new Date(WARSAW_15TH));
    });
  });

  describe('refresh failures', () => {
    it('serves the previous snapshots as stale after a 5xx and a rate limit', async () => {
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
      [
        'a payload missing one required hour mid-window',
        'INSUFFICIENT_COVERAGE',
        () => withoutHour(atmosphericBody({ firstHour: PENICHE_TODAY }), '2026-11-17T13:00:00Z'),
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

  describe('stored rows', () => {
    it('does not reuse a snapshot stored under another schema version', async () => {
      await weatherFor(PENICHE);
      await prisma.$executeRaw`UPDATE forecast_snapshots SET schema_version = 0`;

      const weather = await weatherFor(PENICHE);

      expect(weather.atmospheric.freshness).toBe('FRESH');
      expect(provider.calls).toEqual({ atmospheric: 2, marine: 2 });
      expect((await snapshotRows()).map((row) => row.schema_version)).toEqual([0, 1, 0, 1]);
    });

    it('treats an unreadable stored row as missing and replaces it', async () => {
      await weatherFor(PENICHE);
      await prisma.$executeRaw`
        UPDATE forecast_snapshots SET hourly = '{"time": "broken"}' WHERE source = 'ATMOSPHERIC'`;

      const weather = await weatherFor(PENICHE);

      expect(weather.atmospheric.freshness).toBe('FRESH');
      expect(provider.calls).toEqual({ atmospheric: 2, marine: 1 });
      const [atmosphericRow] = await snapshotRows();
      expect(atmosphericRow.hourly.time).toHaveLength(192);
    });

    it('keeps one snapshot per location and source', async () => {
      provider.atmospheric = () => warsawAtmospheric(WARSAW_14TH);
      provider.marine = () => warsawMarine(WARSAW_14TH);
      await weatherFor(WARSAW);
      provider = new FakeOpenMeteo();

      await weatherFor(PENICHE);
      await weatherFor(WARSAW);

      expect(provider.calls).toEqual({ atmospheric: 1, marine: 1 });
      expect((await snapshotRows()).map((row) => `${row.location_id}:${row.source}`)).toEqual([
        `${PENICHE.id}:ATMOSPHERIC`,
        `${PENICHE.id}:MARINE`,
        `${WARSAW.id}:ATMOSPHERIC`,
        `${WARSAW.id}:MARINE`,
      ]);
    });
  });
});

/** The payload without the row at `instant`, in the timestamps and every series alike. */
function withoutHour(body: Payload, instant: string): Payload {
  const index = body.hourly.time.indexOf(Date.parse(instant) / 1000);
  const hourly = Object.fromEntries(
    Object.entries(body.hourly).map(([name, values]) => [
      name,
      values.filter((_, position) => position !== index),
    ]),
  );
  return { ...body, hourly };
}
