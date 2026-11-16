// Must come first: AppModule reads the environment when it is imported.
import '../support/production-env';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { FakeOpenMeteo } from '../support/fake-open-meteo';
import { FixedClock } from '../support/fixed-clock';
import { postForecast, startForecastApp } from '../support/forecast-app';

/**
 * ARC-59: with NODE_ENV=production and no GRAPHQL_INTROSPECTION, introspection
 * is off while ordinary queries keep working.
 */
describe('GraphQL introspection in production (e2e)', () => {
  let app: INestApplication<App>;
  const upstream = new FakeOpenMeteo();

  beforeAll(async () => {
    app = await startForecastApp(new FixedClock('2026-11-14T12:00:00.000Z'), upstream.fetch);
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['__schema', '{ __schema { queryType { name } } }'],
    ['__type', '{ __type(name: "Location") { name } }'],
  ])('rejects a %s query by default', async (_name, query) => {
    const response = await request(app.getHttpServer()).post('/graphql').send({ query });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        extensions: {
          code: 'GRAPHQL_VALIDATION_FAILED',
          validationErrorCode: 'INTROSPECTION_DISABLED',
        },
      }),
    ]);
  });

  it('still answers a forecast query', async () => {
    await expect(postForecast(app, { city: 'Peniche' })).resolves.toMatchObject({
      __typename: 'ActivityForecast',
    });
    expect(upstream.misses).toEqual([]);
  });
});
