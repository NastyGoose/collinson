// Must come first: AppModule reads the environment when it is imported.
import '../support/production-introspection-env';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { FakeOpenMeteo } from '../support/fake-open-meteo';
import { FixedClock } from '../support/fixed-clock';
import { postGraphQL, startForecastApp } from '../support/forecast-app';

/**
 * ARC-59: GRAPHQL_INTROSPECTION=true turns introspection on even with
 * NODE_ENV=production, where Apollo's own default would turn it off. This shows
 * the setting, not Apollo's default, decides.
 */
describe('GraphQL introspection override (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await startForecastApp(
      new FixedClock('2026-11-14T12:00:00.000Z'),
      new FakeOpenMeteo().fetch,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows introspection when GRAPHQL_INTROSPECTION is true', async () => {
    await expect(postGraphQL(app, '{ __schema { queryType { name } } }', {})).resolves.toEqual({
      data: { __schema: { queryType: { name: 'Query' } } },
    });
  });
});
