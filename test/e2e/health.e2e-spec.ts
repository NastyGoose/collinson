import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';

describe('GraphQL endpoint (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers the health query with the API and PostgreSQL up', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ health { service database } }' })
      .expect(200);

    expect(response.body).toEqual({ data: { health: { service: 'UP', database: 'UP' } } });
  });

  it('rejects a field outside the published schema', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ notAField }' })
      .expect(400);

    expect(response.body.errors[0].extensions.code).toBe('GRAPHQL_VALIDATION_FAILED');
  });
});
