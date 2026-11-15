import { INestApplication, Logger } from '@nestjs/common';
import { App } from 'supertest/types';
import { ForecastRepository } from '../../src/forecast/forecast.repository';
import type { HttpFetch } from '../../src/http/http.types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { resultsBody, WARSAW_PL } from '../fixtures/open-meteo-geocoding';
import {
  atmosphericBody,
  hourlyTimes,
  marineBody,
  PENICHE,
  WARSAW,
  WARSAW_OFFSET,
  type HourlyOptions,
  type Payload,
} from '../fixtures/open-meteo-weather';
import { deferred } from '../support/deferred';
import { FixedClock } from '../support/fixed-clock';
import { jsonResponse, timeoutError } from '../support/fixture-fetch';
import { FakeOpenMeteo, PENICHE_TODAY } from '../support/fake-open-meteo';
import {
  FORECAST_QUERY,
  LOCATIONS_QUERY,
  postForecast,
  postGraphQL,
  startForecastApp,
  type ForecastBody,
  type RankedDayBody,
} from '../support/forecast-app';
import { callsSettled } from '../support/settled';

/**
 * The Implementation Plan's E2E acceptance scenarios (ARC-49), driven through
 * /graphql against the per-run PostgreSQL database built from the checked-in
 * migrations, with a fixed clock and fixture Open-Meteo. The published contract
 * itself is covered by activity-forecast.e2e-spec.ts.
 */

const NOON = '2026-11-14T12:00:00.000Z';
const HOUR_MS = 60 * 60 * 1000;
/** Tomorrow and the six dates after it for the 14 November requests in Lisbon, Chicago and, before midnight, Warsaw. */
const WINDOW = [
  '2026-11-15',
  '2026-11-16',
  '2026-11-17',
  '2026-11-18',
  '2026-11-19',
  '2026-11-20',
  '2026-11-21',
];
/** The window of a request on 15 November. */
const NEXT_WINDOW = [...WINDOW.slice(1), '2026-11-22'];
/** Warsaw is UTC+1 in November: local midnight of the 14th and the 15th in UTC. */
const WARSAW_14TH = '2026-11-13T23:00:00Z';
const WARSAW_15TH = '2026-11-14T23:00:00Z';
const ACTIVITIES = ['SKIING', 'SURFING', 'OUTDOOR_SIGHTSEEING', 'INDOOR_SIGHTSEEING'];
const ATMOSPHERIC_ACTIVITIES = ['SKIING', 'OUTDOOR_SIGHTSEEING', 'INDOOR_SIGHTSEEING'];

const warsawAtmospheric = (firstHour: string) =>
  jsonResponse(atmosphericBody({ firstHour, ...WARSAW_OFFSET }));
/** Complete waves at a grid point on Warsaw itself, so surfing passes the 25 km check. */
const warsawMarine = (firstHour: string) =>
  jsonResponse(
    marineBody({
      firstHour,
      latitude: WARSAW.latitude,
      longitude: WARSAW.longitude,
      ...WARSAW_OFFSET,
    }),
  );
const outage = () => jsonResponse({ error: true, reason: 'down' }, 503);

/** `YYYY-MM-DDThh` on the local wall clock, computed independently of the app's own conversion. */
function localHourKey(epochSeconds: number, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(epochSeconds * 1000)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}`;
}

/**
 * The Technical Design's worked example, keyed to local hours: 20 °C at 09:00–17:00
 * local and null at every other hour, no precipitation unless listed (by local
 * `YYYY-MM-DDThh`, the hour each value ends), 25 km/h wind and no snow. A sample
 * matched to the wrong local hour reads a null temperature and makes the day
 * unavailable, so an available day proves the local-hour matching.
 */
function workedExampleAtmosphere(
  options: HourlyOptions & { timezone: string; precipitation?: Record<string, number> },
): Payload {
  const body = atmosphericBody(options);
  const time = hourlyTimes(options.firstHour, options.hours);
  const keys = time.map((seconds) => localHourKey(seconds, options.timezone));
  body.hourly = {
    time,
    temperature_2m: keys.map((key) => {
      const hour = Number(key.slice(-2));
      return hour >= 9 && hour <= 17 ? 20 : null;
    }),
    snow_depth: time.map(() => 0),
    precipitation: keys.map((key) => options.precipitation?.[key] ?? 0),
    wind_speed_10m: time.map(() => 25),
  };
  return body;
}

function ranking(result: ForecastBody, activity: string): RankedDayBody[] {
  const found = result.activities?.find((group) => group.activity === activity);
  if (found === undefined) {
    throw new Error(`no ${activity} ranking in ${JSON.stringify(result)}`);
  }
  return found.days;
}

/** Four groups in SDL order, each with the window's seven dates once. */
function expectFourGroupsOf(result: ForecastBody, dates: string[]): void {
  expect(result.__typename).toBe('ActivityForecast');
  expect(result).toMatchObject({ startDate: dates[0], endDate: dates[6] });
  expect(result.activities?.map((group) => group.activity)).toEqual(ACTIVITIES);
  for (const group of result.activities ?? []) {
    expect(group.days.map((day) => day.date).sort()).toEqual(dates);
  }
}

function expectAvailable(days: RankedDayBody[]): void {
  expect(days.map((day) => day.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  for (const day of days) {
    expect(day).toMatchObject({ availability: 'AVAILABLE', unavailableCode: null });
    expect(Number.isInteger(day.score)).toBe(true);
  }
}

function expectUnavailable(days: RankedDayBody[], code: string, dates: string[]): void {
  // Unavailable days follow in date order.
  expect(days.map((day) => day.date)).toEqual(dates);
  for (const day of days) {
    expect(day).toMatchObject({
      availability: 'UNAVAILABLE',
      score: null,
      rank: null,
      unavailableCode: code,
    });
    expect(day.reason).toEqual(expect.any(String));
  }
}

describe('activity forecast scenarios (e2e)', () => {
  let app: INestApplication<App>;
  /** False between closing the app and its restart, so afterAll never closes it twice. */
  let appRunning = false;
  let prisma: PrismaService;
  let upstream: FakeOpenMeteo;
  const clock = new FixedClock(NOON);

  function startApp(): Promise<INestApplication<App>> {
    // Delegates to the current test's fixtures, which beforeEach replaces.
    return startForecastApp(clock, ((input, init) =>
      upstream.fetch(input, init)) satisfies HttpFetch);
  }

  function forecast(input: Record<string, unknown>): Promise<ForecastBody> {
    return postForecast(app, input);
  }

  /** Stores a city's single candidate through the `locations` query, without weather. */
  async function storeLocation(city: string): Promise<void> {
    const body = await postGraphQL(app, LOCATIONS_QUERY, { city });
    expect(body.data?.locations).toHaveLength(1);
  }

  function snapshotRows() {
    return prisma.$queryRaw<{ source: string; fetched_at: Date; hours: number }[]>`
      SELECT source::text, fetched_at, jsonb_array_length(hourly->'time') AS hours
      FROM forecast_snapshots ORDER BY source`;
  }

  beforeAll(async () => {
    app = await startApp();
    appRunning = true;
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    // Refresh failures log a warning by design; keep the test output readable.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    upstream = new FakeOpenMeteo();
    clock.set(NOON);
    await prisma.$executeRaw`TRUNCATE forecast_snapshots, location_search_results, location_searches, locations`;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    expect(upstream.misses).toEqual([]);
  });

  afterAll(async () => {
    if (appRunning) {
      await app.close();
    }
  });

  describe('location selection', () => {
    it('ranks a stored candidate by ID while geocoding is down', async () => {
      await expect(forecast({ city: 'Springfield' })).resolves.toMatchObject({
        __typename: 'AmbiguousLocation',
      });
      for (const name of Object.keys(upstream.geocoding)) {
        upstream.geocoding[name] = outage;
      }
      const down = await postGraphQL(app, FORECAST_QUERY, { input: { city: 'Peniche' } });
      expect(down.errors?.[0].extensions).toEqual({ code: 'GEOCODING_UNAVAILABLE' });
      const geocodingCalls = upstream.calls.geocoding;
      // America/Chicago is UTC-6 in November.
      upstream.atmospheric = () =>
        jsonResponse(atmosphericBody({ firstHour: '2026-11-14T06:00:00Z' }));
      upstream.marine = () =>
        jsonResponse(marineBody({ firstHour: '2026-11-14T06:00:00Z', waves: 'null' }));

      const result = await forecast({ locationId: '4250542' });

      expect(upstream.calls.geocoding).toBe(geocodingCalls);
      expect(result).toMatchObject({
        location: { id: '4250542', region: 'Illinois', timezone: 'America/Chicago' },
      });
      expectFourGroupsOf(result, WINDOW);
      expectAvailable(ranking(result, 'OUTDOOR_SIGHTSEEING'));
    });
  });

  describe('local calendar', () => {
    it('keeps the request’s dates when geocoding crosses local midnight, then rolls over', async () => {
      clock.set('2026-11-14T22:59:30.000Z'); // 23:59:30 in Warsaw: window 15th–21st
      upstream.geocoding.warsaw = () => {
        clock.set('2026-11-14T23:00:30.000Z'); // 00:00:30 on the 15th by the time it answers
        return jsonResponse(resultsBody(WARSAW_PL));
      };
      upstream.atmospheric = () => warsawAtmospheric(WARSAW_14TH);
      upstream.marine = () => warsawMarine(WARSAW_14TH);

      const crossing = await forecast({ city: 'Warsaw' });

      expect(crossing).toMatchObject({ location: { id: WARSAW.id } });
      expectFourGroupsOf(crossing, WINDOW);
      for (const group of crossing.activities ?? []) {
        expectAvailable(group.days);
      }

      // The next request is frozen after midnight: its window ends on the 22nd,
      // which the stored snapshots do not cover, so both sources refresh.
      upstream.atmospheric = () => warsawAtmospheric(WARSAW_15TH);
      upstream.marine = () => warsawMarine(WARSAW_15TH);
      const nextDay = await forecast({ locationId: WARSAW.id });

      expectFourGroupsOf(nextDay, NEXT_WINDOW);
      expect(nextDay.sources?.map((status) => status.freshness)).toEqual(['FRESH', 'FRESH']);
      expect(upstream.calls).toEqual({ geocoding: 1, atmospheric: 2, marine: 2 });
    });

    it('gives a request after midnight its own window when it joined an earlier refresh', async () => {
      await storeLocation('Warsaw');
      const held = deferred();
      let attempt = 0;
      upstream.atmospheric = async () => {
        attempt += 1;
        if (attempt === 1) {
          await held.promise;
          return warsawAtmospheric(WARSAW_14TH);
        }
        return warsawAtmospheric(WARSAW_15TH);
      };
      upstream.marine = () => warsawMarine(WARSAW_15TH);
      const reads = jest.spyOn(app.get(ForecastRepository), 'findSnapshot');

      clock.set('2026-11-14T22:59:00.000Z'); // 23:59 in Warsaw: window 15th–21st
      const beforeMidnight = forecast({ locationId: WARSAW.id });
      await callsSettled(reads, 2);
      clock.set('2026-11-14T23:01:00.000Z'); // 00:01 on the 15th: window 16th–22nd
      const readsBefore = reads.mock.calls.length;
      const afterMidnight = forecast({ locationId: WARSAW.id });
      // The late request has read both sources and joined the held atmospheric refresh.
      await callsSettled(reads, readsBefore + 2);
      held.resolve();
      const [early, late] = await Promise.all([beforeMidnight, afterMidnight]);

      expect(upstream.calls.atmospheric).toBe(2);
      expectFourGroupsOf(early, WINDOW);
      expectFourGroupsOf(late, NEXT_WINDOW);
      for (const result of [early, late]) {
        expect(result.sources?.[0]).toMatchObject({ source: 'ATMOSPHERIC', freshness: 'FRESH' });
        for (const group of result.activities ?? []) {
          expectAvailable(group.days);
        }
      }
    });

    it.each([
      {
        change: 'spring-forward',
        // 12:00 WET; clocks go from 01:00 to 02:00 on 29 March.
        requestedAt: '2026-03-25T12:00:00.000Z',
        firstHour: '2026-03-25T00:00:00Z',
        dates: [
          '2026-03-26',
          '2026-03-27',
          '2026-03-28',
          '2026-03-29',
          '2026-03-30',
          '2026-03-31',
          '2026-04-01',
        ],
      },
      {
        change: 'fall-back',
        // 13:00 WEST; clocks go from 02:00 back to 01:00 on 25 October.
        requestedAt: '2026-10-21T12:00:00.000Z',
        firstHour: '2026-10-20T23:00:00Z',
        dates: [
          '2026-10-22',
          '2026-10-23',
          '2026-10-24',
          '2026-10-25',
          '2026-10-26',
          '2026-10-27',
          '2026-10-28',
        ],
      },
    ])(
      'ranks seven local dates across the Lisbon $change change',
      async ({ requestedAt, firstHour, dates }) => {
        clock.set(requestedAt);
        upstream.atmospheric = () =>
          jsonResponse(workedExampleAtmosphere({ firstHour, timezone: PENICHE.timezone }));
        upstream.marine = () => jsonResponse(marineBody({ firstHour }));

        const result = await forecast({ city: 'Peniche' });

        expectFourGroupsOf(result, dates);
        expect(result.sources?.map((status) => status.freshness)).toEqual(['FRESH', 'FRESH']);
        // Every date, the 23- or 25-hour one included, samples exactly 09:00–17:00 local.
        const outdoor = ranking(result, 'OUTDOOR_SIGHTSEEING');
        expect(outdoor.map((day) => day.date)).toEqual(dates);
        expect(outdoor.map((day) => day.score)).toEqual([90, 90, 90, 90, 90, 90, 90]);
        expectAvailable(ranking(result, 'SURFING'));
      },
    );
  });

  describe('persistence and refresh', () => {
    it('makes one fetch per source for simultaneous cold requests', async () => {
      await storeLocation('Peniche');
      const held = deferred();
      const atmospheric = upstream.atmospheric;
      const marine = upstream.marine;
      upstream.atmospheric = async () => {
        await held.promise;
        return atmospheric();
      };
      upstream.marine = async () => {
        await held.promise;
        return marine();
      };
      const reads = jest.spyOn(app.get(ForecastRepository), 'findSnapshot');

      const requests = Array.from({ length: 3 }, () => forecast({ locationId: PENICHE.id }));
      // Each request reads both sources; the first also re-reads in each refresh it starts.
      await callsSettled(reads, 3 * 2 + 2);
      held.resolve();
      const results = await Promise.all(requests);

      expect(upstream.calls).toEqual({ geocoding: 1, atmospheric: 1, marine: 1 });
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
      expect(results[0].sources).toEqual([
        expect.objectContaining({ freshness: 'FRESH', fetchedAt: NOON }),
        expect.objectContaining({ freshness: 'FRESH', fetchedAt: NOON }),
      ]);
    });

    it('reuses the search and both snapshots for a warm request', async () => {
      const first = await forecast({ city: 'Peniche' });
      clock.advance(5 * HOUR_MS + 59 * 60 * 1000); // 17:59, still the 14th in Lisbon

      const second = await forecast({ city: 'Peniche' });

      expect(second).toEqual(first);
      expect(upstream.calls).toEqual({ geocoding: 1, atmospheric: 1, marine: 1 });
    });

    it('reuses the stored search and snapshots after an application restart', async () => {
      const first = await forecast({ city: 'Peniche' });
      await app.close();
      appRunning = false;
      upstream = new FakeOpenMeteo();
      app = await startApp();
      appRunning = true;
      prisma = app.get(PrismaService);
      clock.advance(HOUR_MS);

      const afterRestart = await forecast({ city: 'Peniche' });

      expect(afterRestart).toEqual(first);
      expect(upstream.calls).toEqual({ geocoding: 0, atmospheric: 0, marine: 0 });
    });

    it('serves snapshots as stale for up to 24 hours after failed refreshes, then not at all', async () => {
      // Ten days of hours, so the stored rows still cover the next day's window.
      upstream.atmospheric = () =>
        jsonResponse(atmosphericBody({ firstHour: PENICHE_TODAY, hours: 240 }));
      upstream.marine = () => jsonResponse(marineBody({ firstHour: PENICHE_TODAY, hours: 240 }));
      await forecast({ city: 'Peniche' });
      upstream.atmospheric = outage;
      upstream.marine = () => jsonResponse({ error: true, reason: 'Too many requests' }, 429);

      clock.set('2026-11-15T12:00:00.000Z'); // exactly 24 hours old
      const stale = await forecast({ locationId: PENICHE.id });

      expect(stale.sources).toEqual([
        expect.objectContaining({
          source: 'ATMOSPHERIC',
          freshness: 'STALE',
          fetchedAt: NOON,
          failureCode: 'UPSTREAM_FAILURE',
          reason: expect.any(String),
        }),
        expect.objectContaining({
          source: 'MARINE',
          freshness: 'STALE',
          fetchedAt: NOON,
          failureCode: 'RATE_LIMITED',
          reason: expect.any(String),
        }),
      ]);
      expectFourGroupsOf(stale, NEXT_WINDOW);
      for (const group of stale.activities ?? []) {
        expectAvailable(group.days);
      }

      upstream.atmospheric = () => {
        throw timeoutError();
      };
      clock.advance(1); // one millisecond past the fallback limit
      const expired = await forecast({ locationId: PENICHE.id });

      expect(expired.sources).toEqual([
        expect.objectContaining({
          source: 'ATMOSPHERIC',
          freshness: 'UNAVAILABLE',
          fetchedAt: null,
          failureCode: 'TIMEOUT',
        }),
        expect.objectContaining({
          source: 'MARINE',
          freshness: 'UNAVAILABLE',
          fetchedAt: null,
          failureCode: 'RATE_LIMITED',
        }),
      ]);
      expectFourGroupsOf(expired, NEXT_WINDOW);
      expect(expired.activities?.flatMap((group) => group.days)).toHaveLength(28);
      for (const group of expired.activities ?? []) {
        expectUnavailable(group.days, 'ATMOSPHERIC_UNAVAILABLE', NEXT_WINDOW);
      }
    });

    it('keeps the stored snapshots when a replacement is invalid or short of coverage', async () => {
      await forecast({ city: 'Peniche' });
      const before = await snapshotRows();
      clock.set('2026-11-14T19:00:00.000Z'); // past the six-hour freshness limit
      upstream.atmospheric = () => {
        const body = atmosphericBody({ firstHour: PENICHE_TODAY });
        body.hourly_units.temperature_2m = '°F';
        return jsonResponse(body);
      };
      upstream.marine = () => jsonResponse(marineBody({ firstHour: PENICHE_TODAY, hours: 48 }));

      const result = await forecast({ locationId: PENICHE.id });

      expect(result.sources).toEqual([
        expect.objectContaining({
          source: 'ATMOSPHERIC',
          freshness: 'STALE',
          fetchedAt: NOON,
          failureCode: 'INVALID_PAYLOAD',
        }),
        expect.objectContaining({
          source: 'MARINE',
          freshness: 'STALE',
          fetchedAt: NOON,
          failureCode: 'INSUFFICIENT_COVERAGE',
        }),
      ]);
      expect(await snapshotRows()).toEqual(before);
      expect(before).toEqual([
        { source: 'ATMOSPHERIC', fetched_at: new Date(NOON), hours: 192 },
        { source: 'MARINE', fetched_at: new Date(NOON), hours: 192 },
      ]);
    });
  });

  describe('marine availability', () => {
    it('reports a fresh all-null marine snapshot, leaves surfing unavailable and reuses it', async () => {
      upstream.marine = () => jsonResponse(marineBody({ firstHour: PENICHE_TODAY, waves: 'null' }));

      const result = await forecast({ city: 'Peniche' });

      expect(result.sources?.[1]).toEqual({
        source: 'MARINE',
        freshness: 'FRESH',
        fetchedAt: NOON,
        failureCode: null,
        reason: null,
      });
      const surfing = ranking(result, 'SURFING');
      expectUnavailable(surfing, 'MISSING_MARINE_INPUTS', WINDOW);
      expect(surfing[0].reason).toBe(
        'Missing usable wave height (all 9 hours) and wave period (all 9 hours), so surfing cannot be scored.',
      );
      for (const activity of ATMOSPHERIC_ACTIVITIES) {
        expectAvailable(ranking(result, activity));
      }

      clock.advance(HOUR_MS);
      const again = await forecast({ city: 'Peniche' });

      expect(again).toEqual(result);
      expect(upstream.calls.marine).toBe(1);
    });

    it('leaves only the date with a missing wave sample unavailable for surfing', async () => {
      upstream.marine = () => {
        const body = marineBody({ firstHour: PENICHE_TODAY });
        // 12:00 on the 18th, Lisbon time (UTC+0 in November).
        const index = hourlyTimes(PENICHE_TODAY).indexOf(Date.parse('2026-11-18T12:00:00Z') / 1000);
        body.hourly.wave_period[index] = null;
        return jsonResponse(body);
      };

      const result = await forecast({ city: 'Peniche' });

      expect(result.sources?.[1]).toMatchObject({ source: 'MARINE', freshness: 'FRESH' });
      const surfing = ranking(result, 'SURFING');
      expect(surfing.map((day) => [day.date, day.rank])).toEqual([
        ['2026-11-15', 1],
        ['2026-11-16', 2],
        ['2026-11-17', 3],
        ['2026-11-19', 4],
        ['2026-11-20', 5],
        ['2026-11-21', 6],
        ['2026-11-18', null],
      ]);
      expect(surfing[6]).toEqual({
        date: '2026-11-18',
        availability: 'UNAVAILABLE',
        score: null,
        rank: null,
        reason: 'Missing usable wave period (12:00), so surfing cannot be scored.',
        unavailableCode: 'MISSING_MARINE_INPUTS',
      });
      for (const activity of ATMOSPHERIC_ACTIVITIES) {
        expectAvailable(ranking(result, activity));
      }
    });

    it('leaves surfing unavailable when complete waves come from a grid point over 25 km away', async () => {
      // 0.3° of latitude is about 33.4 km.
      upstream.marine = () =>
        jsonResponse(
          marineBody({
            firstHour: PENICHE_TODAY,
            latitude: PENICHE.latitude + 0.3,
            longitude: PENICHE.longitude,
          }),
        );

      const result = await forecast({ city: 'Peniche' });

      expect(result.sources?.[1]).toMatchObject({ source: 'MARINE', freshness: 'FRESH' });
      const surfing = ranking(result, 'SURFING');
      expectUnavailable(surfing, 'MARINE_GRID_TOO_DISTANT', WINDOW);
      expect(surfing[0].reason).toBe(
        'The marine model grid point is 33.4 km away, beyond the 25 km limit, so surfing cannot be scored.',
      );
      for (const activity of ATMOSPHERIC_ACTIVITIES) {
        expectAvailable(ranking(result, activity));
      }
    });
  });

  describe('source failures', () => {
    it('reports every activity unavailable when only the atmospheric source fails', async () => {
      upstream.atmospheric = outage;

      const result = await forecast({ city: 'Peniche' });

      expect(result.sources).toEqual([
        expect.objectContaining({
          source: 'ATMOSPHERIC',
          freshness: 'UNAVAILABLE',
          fetchedAt: null,
          failureCode: 'UPSTREAM_FAILURE',
        }),
        expect.objectContaining({ source: 'MARINE', freshness: 'FRESH', fetchedAt: NOON }),
      ]);
      expectFourGroupsOf(result, WINDOW);
      // Surfing needs atmospheric wind too, and the atmospheric failure is reported first.
      for (const group of result.activities ?? []) {
        expectUnavailable(group.days, 'ATMOSPHERIC_UNAVAILABLE', WINDOW);
      }
    });
  });

  describe('scoring and explanation', () => {
    it('scores the worked example, counts 18:00 precipitation and ignores 09:00', async () => {
      upstream.atmospheric = () =>
        jsonResponse(
          workedExampleAtmosphere({
            firstHour: PENICHE_TODAY,
            timezone: PENICHE.timezone,
            // The 18:00 value covers 17:00–18:00, inside the window; the 09:00 value
            // covers 08:00–09:00, before it.
            precipitation: { '2026-11-16T18': 4, '2026-11-17T09': 5 },
          }),
        );

      const result = await forecast({ city: 'Peniche' });

      const outdoor = ranking(result, 'OUTDOOR_SIGHTSEEING');
      // Ties resolve by ascending date; the wet day ranks last.
      expect(outdoor.map((day) => [day.date, day.score, day.rank])).toEqual([
        ['2026-11-15', 90, 1],
        ['2026-11-17', 90, 2],
        ['2026-11-18', 90, 3],
        ['2026-11-19', 90, 4],
        ['2026-11-20', 90, 5],
        ['2026-11-21', 90, 6],
        ['2026-11-16', 75, 7],
      ]);
      expect(outdoor[0].reason).toBe(
        'Mean 20.0 °C, 0.0 mm of precipitation and wind up to 25.0 km/h in the 09:00–18:00 window; ' +
          'wind lowers the score most.',
      );
      expect(outdoor[6].reason).toContain('4.0 mm of precipitation');

      const indoor = ranking(result, 'INDOOR_SIGHTSEEING');
      expect(indoor.map((day) => [day.date, day.score])).toEqual([
        ['2026-11-16', 63],
        ['2026-11-15', 55],
        ['2026-11-17', 55],
        ['2026-11-18', 55],
        ['2026-11-19', 55],
        ['2026-11-20', 55],
        ['2026-11-21', 55],
      ]);
      expect(indoor[1].reason).toBe(
        'Outdoor sightseeing scores 90 with mean 20.0 °C, 0.0 mm of precipitation and wind up to ' +
          '25.0 km/h in the 09:00–18:00 window; an indoor alternative gains appeal as outdoor ' +
          'conditions worsen.',
      );

      const skiing = ranking(result, 'SKIING');
      expect(skiing.every((day) => day.score === 0)).toBe(true);
      expect(skiing[0].reason).toMatch(/^No snow on the ground: mean snow depth 0\.000 m/);
    });
  });
});
