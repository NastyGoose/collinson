import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { Clock } from '../../src/clock/clock.service';
import { HTTP_FETCH } from '../../src/http/http.constants';
import type { HttpFetch } from '../../src/http/http.types';

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

/**
 * An `activityForecast` result as FORECAST_QUERY selects it. Every field but
 * `__typename` is optional because the result type decides which are present; a
 * type alias, not an interface, so it stays assignable to Record<string, unknown>.
 */
export type ForecastBody = {
  __typename: 'ActivityForecast' | 'AmbiguousLocation' | 'LocationNotFound';
  location?: Record<string, unknown>;
  startDate?: string;
  endDate?: string;
  scoringVersion?: string;
  attribution?: string;
  activities?: { activity: string; days: RankedDayBody[] }[];
  sources?: SourceStatusBody[];
  candidates?: Record<string, unknown>[];
  message?: string;
};

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
