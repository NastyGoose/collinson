import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { Clock } from '../../src/clock/clock';
import { HTTP_FETCH, type HttpFetch } from '../../src/http/http-fetch';
import {
  NO_MATCH,
  PENICHE_PT,
  resultsBody,
  SPRINGFIELD_IL,
  SPRINGFIELD_MA,
  SPRINGFIELD_MO,
  WARSAW_PL,
} from '../fixtures/open-meteo-geocoding';
import { atmosphericBody, marineBody } from '../fixtures/open-meteo-weather';
import { fixtureFetch, jsonResponse } from './fixture-fetch';

/** Peniche (Europe/Lisbon) is UTC+0 in November: its "today" starts at 00:00 UTC. */
export const PENICHE_TODAY = '2026-11-14T00:00:00Z';

export const FORECAST_QUERY = /* GraphQL */ `
  query Forecast($input: ForecastInput!) {
    activityForecast(input: $input) {
      __typename
      ... on ActivityForecast {
        location {
          id
          name
          country
          region
          latitude
          longitude
          timezone
        }
        startDate
        endDate
        scoringVersion
        attribution
        activities {
          activity
          days {
            date
            availability
            score
            rank
            reason
            unavailableCode
          }
        }
        sources {
          source
          freshness
          fetchedAt
          failureCode
          reason
        }
      }
      ... on AmbiguousLocation {
        candidates {
          id
          name
          region
          timezone
        }
      }
      ... on LocationNotFound {
        message
      }
    }
  }
`;

export const LOCATIONS_QUERY = /* GraphQL */ `
  query Locations($city: String!, $countryCode: String) {
    locations(city: $city, countryCode: $countryCode) {
      id
      name
      country
      region
      timezone
    }
  }
`;

export interface GraphQLBody {
  data?: Record<string, unknown> | null;
  errors?: { message: string; extensions?: Record<string, unknown> }[];
}

export interface RankedDayBody {
  date: string;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  score: number | null;
  rank: number | null;
  reason: string;
  unavailableCode: string | null;
}

export interface SourceStatusBody {
  source: 'ATMOSPHERIC' | 'MARINE';
  freshness: 'FRESH' | 'STALE' | 'UNAVAILABLE';
  fetchedAt: string | null;
  failureCode: string | null;
  reason: string | null;
}

/** An `activityForecast` result as FORECAST_QUERY selects it; fields depend on `__typename`. */
export interface ForecastBody {
  __typename: 'ActivityForecast' | 'AmbiguousLocation' | 'LocationNotFound';
  [field: string]: unknown;
  startDate?: string;
  endDate?: string;
  activities?: { activity: string; days: RankedDayBody[] }[];
  sources?: SourceStatusBody[];
}

type Answer = () => Response | Promise<Response>;

/**
 * Fixture Open-Meteo for all three APIs, routed by host; geocoding by the `name`
 * parameter. Every call is counted, and a request no fixture answers is recorded
 * as a miss, so specs can fail on it instead of reading it as an outage.
 */
export class FakeOpenMeteo {
  geocoding: Record<string, Answer> = {
    peniche: () => jsonResponse(resultsBody(PENICHE_PT)),
    springfield: () => jsonResponse(resultsBody(SPRINGFIELD_MO, SPRINGFIELD_IL, SPRINGFIELD_MA)),
    warsaw: () => jsonResponse(resultsBody(WARSAW_PL)),
    atlantis: () => jsonResponse(NO_MATCH),
  };
  atmospheric: Answer = () => jsonResponse(atmosphericBody({ firstHour: PENICHE_TODAY }));
  marine: Answer = () => jsonResponse(marineBody({ firstHour: PENICHE_TODAY }));
  readonly calls = { geocoding: 0, atmospheric: 0, marine: 0 };
  readonly misses: string[] = [];
  readonly fetch = fixtureFetch((url) => {
    if (url.hostname === 'geocoding-api.open-meteo.com') {
      this.calls.geocoding += 1;
      const answer = this.geocoding[url.searchParams.get('name') ?? ''];
      if (answer !== undefined) {
        return answer();
      }
    } else if (url.hostname === 'api.open-meteo.com') {
      this.calls.atmospheric += 1;
      return this.atmospheric();
    } else if (url.hostname === 'marine-api.open-meteo.com') {
      this.calls.marine += 1;
      return this.marine();
    }
    this.misses.push(url.toString());
    throw new Error(`no fixture for ${url.toString()}`);
  });
}

/**
 * Boots the whole AppModule against the per-run test database, with the clock and
 * HTTP_FETCH replaced. `fetch` should delegate to the current test's fixtures, so
 * one app can serve many tests.
 */
export async function startForecastApp(
  clock: Clock,
  fetch: HttpFetch,
): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(HTTP_FETCH)
    .useValue(fetch)
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  await app.init();
  return app;
}

/** Posts one operation to /graphql; GraphQL answers 200 for results and resolver errors. */
export async function postGraphQL(
  app: INestApplication<App>,
  query: string,
  variables: Record<string, unknown>,
): Promise<GraphQLBody> {
  const response = await request(app.getHttpServer())
    .post('/graphql')
    .send({ query, variables })
    .expect(200);
  return response.body as GraphQLBody;
}

/** The `activityForecast` result of a request that must not raise a GraphQL error. */
export async function postForecast(
  app: INestApplication<App>,
  input: Record<string, unknown>,
): Promise<ForecastBody> {
  const body = await postGraphQL(app, FORECAST_QUERY, { input });
  expect(body.errors).toBeUndefined();
  return (body.data as { activityForecast: ForecastBody }).activityForecast;
}
