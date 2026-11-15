import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication, Logger } from '@nestjs/common';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import {
  buildSchema,
  findBreakingChanges,
  findDangerousChanges,
  type GraphQLSchema,
} from 'graphql';
import { App } from 'supertest/types';
import { ATTRIBUTION } from '../../src/activity-forecast/activity-forecast.constants';
import { ForecastStorageUnavailableError } from '../../src/forecast/forecast.errors';
import { ForecastRepository } from '../../src/forecast/forecast.repository';
import type { HttpFetch } from '../../src/http/http.types';
import { StorageUnavailableError } from '../../src/location/location.errors';
import { LocationRepository } from '../../src/location/location.repository';
import { PrismaService } from '../../src/prisma/prisma.service';
import { atmosphericBody, marineBody, PENICHE } from '../fixtures/open-meteo-weather';
import { FixedClock } from '../support/fixed-clock';
import { jsonResponse, timeoutError } from '../support/fixture-fetch';
import { FakeOpenMeteo } from '../support/fake-open-meteo';
import {
  FORECAST_QUERY,
  LOCATIONS_QUERY,
  postForecast,
  postGraphQL,
  startForecastApp,
  type GraphQLBody,
} from '../support/forecast-app';

const NOON = '2026-11-14T12:00:00.000Z';
const WINDOW_DATES = [
  '2026-11-15',
  '2026-11-16',
  '2026-11-17',
  '2026-11-18',
  '2026-11-19',
  '2026-11-20',
  '2026-11-21',
];

/** The Technical Design SDL, verbatim: the contract the served schema must match. */
const TECHNICAL_DESIGN_SDL = /* GraphQL */ `
  type Query {
    locations(city: String!, countryCode: String): [Location!]!
    activityForecast(input: ForecastInput!): ForecastResult!
  }
  input ForecastInput {
    city: String
    countryCode: String
    locationId: ID
  }
  union ForecastResult = ActivityForecast | AmbiguousLocation | LocationNotFound
  type Location {
    id: ID!
    name: String!
    country: String!
    region: String
    latitude: Float!
    longitude: Float!
    timezone: String!
  }
  type AmbiguousLocation {
    candidates: [Location!]!
  }
  type LocationNotFound {
    message: String!
  }
  type ActivityForecast {
    location: Location!
    startDate: String!
    endDate: String!
    scoringVersion: String!
    activities: [ActivityRanking!]!
    sources: [SourceStatus!]!
    attribution: String!
  }
  enum Activity {
    SKIING
    SURFING
    OUTDOOR_SIGHTSEEING
    INDOOR_SIGHTSEEING
  }
  type ActivityRanking {
    activity: Activity!
    days: [RankedDay!]!
  }
  enum DayAvailability {
    AVAILABLE
    UNAVAILABLE
  }
  enum DayUnavailableCode {
    ATMOSPHERIC_UNAVAILABLE
    MARINE_UNAVAILABLE
    MISSING_ATMOSPHERIC_INPUTS
    MISSING_MARINE_INPUTS
    INVALID_MARINE_GRID
    MARINE_GRID_TOO_DISTANT
  }
  type RankedDay {
    date: String!
    availability: DayAvailability!
    score: Int
    rank: Int
    reason: String!
    unavailableCode: DayUnavailableCode
  }
  enum WeatherSource {
    ATMOSPHERIC
    MARINE
  }
  enum Freshness {
    FRESH
    STALE
    UNAVAILABLE
  }
  enum SourceFailureCode {
    TIMEOUT
    UPSTREAM_FAILURE
    RATE_LIMITED
    INVALID_PAYLOAD
    INSUFFICIENT_COVERAGE
  }
  type SourceStatus {
    source: WeatherSource!
    freshness: Freshness!
    fetchedAt: String
    failureCode: SourceFailureCode
    reason: String
  }
`;

describe('activity forecast GraphQL contract (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let upstream: FakeOpenMeteo;
  const clock = new FixedClock(NOON);

  function post(query: string, variables: Record<string, unknown>): Promise<GraphQLBody> {
    return postGraphQL(app, query, variables);
  }

  async function forecast(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return postForecast(app, input);
  }

  beforeAll(async () => {
    // Delegates to the current test's fixtures, which beforeEach replaces.
    app = await startForecastApp(clock, ((input, init) =>
      upstream.fetch(input, init)) satisfies HttpFetch);
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    upstream = new FakeOpenMeteo();
    clock.set(NOON);
    await prisma.$executeRaw`TRUNCATE forecast_snapshots, location_search_results, location_searches, locations`;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    expect(upstream.misses).toEqual([]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the Technical Design SDL', () => {
    const health = readFileSync(join(__dirname, '../../src/health/health.graphql'), 'utf8');
    const expected: GraphQLSchema = buildSchema(
      TECHNICAL_DESIGN_SDL + health.replace('type Query', 'extend type Query'),
    );
    const served = app.get(GraphQLSchemaHost).schema;

    for (const [from, to] of [
      [expected, served],
      [served, expected],
    ]) {
      expect(findBreakingChanges(from, to)).toEqual([]);
      expect(findDangerousChanges(from, to)).toEqual([]);
    }
  });

  it('ranks a unique city: four groups of the seven local dates, fresh sources', async () => {
    const result = await forecast({ city: '  Peniche ' });

    expect(result).toMatchObject({
      __typename: 'ActivityForecast',
      location: PENICHE,
      startDate: '2026-11-15',
      endDate: '2026-11-21',
      scoringVersion: 'v1',
      attribution: ATTRIBUTION,
      sources: [
        {
          source: 'ATMOSPHERIC',
          freshness: 'FRESH',
          fetchedAt: NOON,
          failureCode: null,
          reason: null,
        },
        { source: 'MARINE', freshness: 'FRESH', fetchedAt: NOON, failureCode: null, reason: null },
      ],
    });
    const activities = result.activities as {
      activity: string;
      days: { date: string; availability: string; score: number | null; rank: number | null }[];
    }[];
    expect(activities.map((ranking) => ranking.activity)).toEqual([
      'SKIING',
      'SURFING',
      'OUTDOOR_SIGHTSEEING',
      'INDOOR_SIGHTSEEING',
    ]);
    for (const ranking of activities) {
      expect(ranking.days.map((day) => day.date).sort()).toEqual(WINDOW_DATES);
      expect(ranking.days.map((day) => day.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(ranking.days.every((day) => Number.isInteger(day.score))).toBe(true);
    }
    expect(upstream.calls).toEqual({ geocoding: 1, atmospheric: 1, marine: 1 });
  });

  it('returns distinct candidates for an ambiguous city and no rankings', async () => {
    const result = await forecast({ city: 'Springfield' });

    expect(result).toEqual({
      __typename: 'AmbiguousLocation',
      candidates: [
        { id: '4409896', name: 'Springfield', region: 'Missouri', timezone: 'America/Chicago' },
        { id: '4250542', name: 'Springfield', region: 'Illinois', timezone: 'America/Chicago' },
        {
          id: '4951788',
          name: 'Springfield',
          region: 'Massachusetts',
          timezone: 'America/New_York',
        },
      ],
    });
    expect(upstream.calls.atmospheric + upstream.calls.marine).toBe(0);
  });

  it('ranks a candidate selected by its stored ID without geocoding again', async () => {
    await forecast({ city: 'Springfield' });
    upstream.atmospheric = () =>
      jsonResponse(
        atmosphericBody({ firstHour: '2026-11-14T06:00:00Z', timezone: 'America/Chicago' }),
      );
    upstream.marine = () =>
      jsonResponse(marineBody({ firstHour: '2026-11-14T06:00:00Z', waves: 'null' }));

    const result = await forecast({ locationId: '4250542' });

    expect(result).toMatchObject({
      __typename: 'ActivityForecast',
      location: { id: '4250542', region: 'Illinois', timezone: 'America/Chicago' },
      startDate: '2026-11-15',
    });
    expect(upstream.calls.geocoding).toBe(1);
  });

  it.each([
    ['an unknown city', { city: 'Atlantis' }, 'No location matches "Atlantis".'],
    ['an unknown stored ID', { locationId: '999' }, 'No stored location has ID "999".'],
  ])('returns a typed not-found result for %s', async (_name, input, message) => {
    await expect(forecast(input)).resolves.toEqual({ __typename: 'LocationNotFound', message });
  });

  it.each([
    ['both selectors', { city: 'Peniche', locationId: '2264508' }, null],
    ['no selector', {}, null],
    [
      'a country filter with a stored ID',
      { locationId: '2264508', countryCode: 'PT' },
      'countryCode',
    ],
    ['a one-letter city', { city: ' P ' }, 'city'],
  ])('rejects %s with BAD_USER_INPUT', async (_name, input, field) => {
    const body = await post(FORECAST_QUERY, { input });

    expect(body.data).toBeNull();
    expect(body.errors).toHaveLength(1);
    expect(body.errors?.[0].extensions).toEqual({ code: 'BAD_USER_INPUT', field });
    expect(upstream.calls.geocoding).toBe(0);
  });

  it('reports a snapshot storage failure as STORAGE_UNAVAILABLE', async () => {
    jest
      .spyOn(app.get(ForecastRepository), 'findSnapshot')
      // Both sources fail their read, so no refresh outlives the response.
      .mockRejectedValue(
        new ForecastStorageUnavailableError('Could not read a forecast snapshot.'),
      );

    const body = await post(FORECAST_QUERY, { input: { city: 'Peniche' } });

    expect(body).toEqual({
      data: null,
      errors: [
        expect.objectContaining({
          message: 'Could not read a forecast snapshot.',
          extensions: { code: 'STORAGE_UNAVAILABLE' },
        }),
      ],
    });
  });

  it('reports a location storage failure as STORAGE_UNAVAILABLE', async () => {
    jest
      .spyOn(app.get(LocationRepository), 'findFreshSearch')
      .mockRejectedValue(new StorageUnavailableError('Could not read a location search.'));

    for (const [query, variables] of [
      [FORECAST_QUERY, { input: { city: 'Peniche' } }],
      [LOCATIONS_QUERY, { city: 'Peniche' }],
    ] as const) {
      const body = await post(query, variables);

      expect(body.data).toBeNull();
      expect(body.errors?.[0]).toMatchObject({
        message: 'Could not read a location search.',
        extensions: { code: 'STORAGE_UNAVAILABLE' },
      });
    }
    expect(upstream.calls.geocoding).toBe(0);
  });

  it('masks an unexpected failure as INTERNAL_SERVER_ERROR without its details', async () => {
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest
      .spyOn(app.get(ForecastRepository), 'findSnapshot')
      .mockRejectedValue(new Error('relation "forecast_snapshots" does not exist'));

    const body = await post(FORECAST_QUERY, { input: { city: 'Peniche' } });

    expect(body).toEqual({
      data: null,
      errors: [
        {
          message: 'Internal server error.',
          locations: expect.any(Array),
          path: ['activityForecast'],
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        },
      ],
    });
    expect(logError).toHaveBeenCalled();
  });

  it('reports a geocoding outage as GEOCODING_UNAVAILABLE without provider details', async () => {
    upstream.geocoding.peniche = () => jsonResponse({ error: true, reason: 'internal' }, 503);

    for (const [query, variables] of [
      [FORECAST_QUERY, { input: { city: 'Peniche' } }],
      [LOCATIONS_QUERY, { city: 'Peniche' }],
    ] as const) {
      const body = await post(query, variables);

      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions).toEqual({ code: 'GEOCODING_UNAVAILABLE' });
      expect(body.errors?.[0].message).toBe('Geocoding answered HTTP 503.');
    }
  });

  it('lists the candidates for a city and rejects an invalid country filter', async () => {
    await expect(
      post(LOCATIONS_QUERY, { city: 'springfield', countryCode: null }),
    ).resolves.toEqual({
      data: {
        locations: [
          expect.objectContaining({ id: '4409896' }),
          expect.objectContaining({ id: '4250542' }),
          expect.objectContaining({ id: '4951788' }),
        ],
      },
    });

    const invalid = await post(LOCATIONS_QUERY, { city: 'Springfield', countryCode: 'USA' });
    expect(invalid.errors?.[0].extensions).toEqual({
      code: 'BAD_USER_INPUT',
      field: 'countryCode',
    });
  });

  it('keeps the atmospheric rankings and explains surfing during a marine timeout', async () => {
    upstream.marine = () => {
      throw timeoutError();
    };

    const result = await forecast({ city: 'Peniche' });

    const [atmospheric, marine] = result.sources as Record<string, unknown>[];
    expect(atmospheric).toMatchObject({ freshness: 'FRESH', fetchedAt: NOON });
    expect(marine).toMatchObject({
      source: 'MARINE',
      freshness: 'UNAVAILABLE',
      fetchedAt: null,
      failureCode: 'TIMEOUT',
    });
    expect(marine.reason).toEqual(expect.any(String));
    const activities = result.activities as {
      activity: string;
      days: Record<string, unknown>[];
    }[];
    for (const ranking of activities) {
      expect(ranking.days).toHaveLength(7);
      const surfing = ranking.activity === 'SURFING';
      for (const day of ranking.days) {
        expect(day).toMatchObject(
          surfing
            ? {
                availability: 'UNAVAILABLE',
                score: null,
                rank: null,
                unavailableCode: 'MARINE_UNAVAILABLE',
              }
            : { availability: 'AVAILABLE', unavailableCode: null },
        );
      }
    }
  });

  it('reports each source on its own: a refreshed atmosphere beside a stale marine snapshot', async () => {
    await forecast({ city: 'Peniche' });
    // Past the six-hour freshness limit, within the 24-hour stale fallback, same local date.
    clock.set('2026-11-14T19:00:00.000Z');
    upstream.marine = () => jsonResponse({ error: true, reason: 'Too many requests' }, 429);

    const result = await forecast({ city: 'Peniche' });

    expect(result.sources).toEqual([
      {
        source: 'ATMOSPHERIC',
        freshness: 'FRESH',
        fetchedAt: '2026-11-14T19:00:00.000Z',
        failureCode: null,
        reason: null,
      },
      expect.objectContaining({
        source: 'MARINE',
        freshness: 'STALE',
        fetchedAt: NOON,
        failureCode: 'RATE_LIMITED',
        reason: expect.any(String),
      }),
    ]);
    const surfing = (
      result.activities as { activity: string; days: Record<string, unknown>[] }[]
    )[1];
    expect(surfing.activity).toBe('SURFING');
    expect(surfing.days.every((day) => day.availability === 'AVAILABLE')).toBe(true);
  });

  it('returns 28 dated entries with null scores during a complete weather outage', async () => {
    upstream.atmospheric = () => jsonResponse({ error: true, reason: 'down' }, 503);
    upstream.marine = () => jsonResponse({ error: true, reason: 'down' }, 503);

    const result = await forecast({ city: 'Peniche' });

    expect(result).toMatchObject({ __typename: 'ActivityForecast', location: PENICHE });
    expect(result.sources).toEqual([
      expect.objectContaining({
        source: 'ATMOSPHERIC',
        freshness: 'UNAVAILABLE',
        fetchedAt: null,
        failureCode: 'UPSTREAM_FAILURE',
      }),
      expect.objectContaining({
        source: 'MARINE',
        freshness: 'UNAVAILABLE',
        fetchedAt: null,
        failureCode: 'UPSTREAM_FAILURE',
      }),
    ]);
    const activities = result.activities as { days: Record<string, unknown>[] }[];
    expect(activities).toHaveLength(4);
    const days = activities.flatMap((ranking) => ranking.days);
    expect(days).toHaveLength(28);
    for (const ranking of activities) {
      expect(ranking.days.map((day) => day.date)).toEqual(WINDOW_DATES);
    }
    for (const day of days) {
      expect(day).toMatchObject({
        availability: 'UNAVAILABLE',
        score: null,
        rank: null,
        unavailableCode: 'ATMOSPHERIC_UNAVAILABLE',
      });
      expect(day.reason).toEqual(expect.any(String));
    }
  });
});
