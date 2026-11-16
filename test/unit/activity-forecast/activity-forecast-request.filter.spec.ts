import {
  BadRequestException,
  Body,
  Controller,
  type INestApplication,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { RequestErrorFilter } from '../../../src/activity-forecast/activity-forecast-request.filter';

/** Benign marker: no response may contain it. */
const SENTINEL = 'ARC59_SENTINEL_BODY';

@Controller()
class EchoController {
  @Post('echo')
  echo(@Body() body: unknown): unknown {
    return body;
  }

  @Post('missing')
  missing(): never {
    throw new NotFoundException('No such thing.');
  }
}

describe('RequestErrorFilter', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoController],
      providers: [{ provide: APP_FILTER, useClass: RequestErrorFilter }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function post(path: string): request.Test {
    return request(app.getHttpServer()).post(path);
  }

  it.each([
    ['an unterminated string', `{"query": "${SENTINEL}`],
    ['a bare word', SENTINEL],
    ['a trailing comma', `{"query": "${SENTINEL}",}`],
  ])('answers malformed JSON (%s) with 400 and a fixed message', async (_name, body) => {
    const response = await post('/echo').set('Content-Type', 'application/json').send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: [
        { message: 'The request body is not valid JSON.', extensions: { code: 'BAD_REQUEST' } },
      ],
    });
    expect(response.text).not.toContain(SENTINEL);
    expect(response.text).not.toMatch(/position|token|Unexpected|Unterminated/i);
  });

  it('answers an unsupported charset with 415 without echoing it', async () => {
    const response = await post('/echo')
      .set('Content-Type', `application/json; charset=${SENTINEL}`)
      .send('{}');

    expect(response.status).toBe(415);
    expect(response.body).toEqual({
      errors: [
        {
          message: 'The request body charset is not supported.',
          extensions: { code: 'BAD_REQUEST' },
        },
      ],
    });
    expect(response.text).not.toContain(SENTINEL);
  });

  it('answers an unsupported content encoding with 415 without echoing it', async () => {
    const response = await post('/echo')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', SENTINEL)
      .send('{}');

    expect(response.status).toBe(415);
    expect(response.body.errors[0].message).toBe(
      'The request body content encoding is not supported.',
    );
    expect(response.text).not.toContain(SENTINEL);
  });

  it('answers a body over the parser limit with 413', async () => {
    const response = await post('/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ query: SENTINEL.repeat(20_000) }));

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      errors: [{ message: 'The request body is too large.', extensions: { code: 'BAD_REQUEST' } }],
    });
  });

  it('lets a valid body through', async () => {
    const response = await post('/echo').send({ query: '{ health }' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ query: '{ health }' });
  });

  it.each([
    ['post' as const, `/${SENTINEL}`],
    ['get' as const, `/echo/${SENTINEL}?q=${SENTINEL}`],
    ['delete' as const, '/echo'],
  ])('answers an unknown route (%s %s) with 404 without echoing the path', async (method, path) => {
    const response = await request(app.getHttpServer())[method](path);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      message: 'No route matches the request.',
      error: 'Not Found',
      statusCode: 404,
    });
    expect(response.text).not.toContain(SENTINEL);
    expect(response.text).not.toContain('/echo');
  });

  it("keeps a controller's own 404 and Nest's default answer for it", async () => {
    const response = await post('/missing').send({});

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      message: 'No such thing.',
      error: 'Not Found',
      statusCode: 404,
    });
  });

  it("leaves an exception raised in a GraphQL resolver to Nest's default handling", () => {
    const host = new ExecutionContextHost([]);
    host.setType('graphql');

    // Undefined means "not handled": Nest's external handler logs and rethrows it.
    expect(
      new RequestErrorFilter().catch(new BadRequestException('From a resolver.'), host),
    ).toBeUndefined();
  });
});
