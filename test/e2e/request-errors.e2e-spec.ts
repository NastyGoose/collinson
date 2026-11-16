import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { NO_MATCH } from '../fixtures/open-meteo-geocoding';
import { FakeOpenMeteo } from '../support/fake-open-meteo';
import { jsonResponse } from '../support/fixture-fetch';
import { FixedClock } from '../support/fixed-clock';
import {
  FORECAST_QUERY,
  LOCATIONS_QUERY,
  postForecast,
  postGraphQL,
  startForecastApp,
} from '../support/forecast-app';
import type { HttpFetch } from '../../src/http/http.types';

/**
 * Benign markers standing in for submitted values. No response may contain one,
 * in any letter case: city searches are lowercased before they reach geocoding.
 */
const SENTINEL = 'Arc59Sentinel';
const SENTINEL_ID = '987654321';

function expectNoSentinel(text: string): void {
  expect(text.toLowerCase()).not.toContain(SENTINEL.toLowerCase());
  expect(text).not.toContain(SENTINEL_ID);
}

/**
 * ARC-59: request errors and LocationNotFound answers carry fixed messages that
 * never reflect the caller's values, parser diagnostics or stack traces, while
 * status codes, error codes, typed outcomes and domain field metadata stay as
 * published. Runs the whole AppModule over HTTP against fixture Open-Meteo.
 */
describe('request errors at the HTTP and GraphQL boundary (e2e)', () => {
  let app: INestApplication<App>;
  let upstream: FakeOpenMeteo;

  function postRaw(body: string | object, contentType = 'application/json'): request.Test {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('Content-Type', contentType)
      .send(body);
  }

  beforeAll(async () => {
    app = await startForecastApp(new FixedClock('2026-11-14T12:00:00.000Z'), ((input, init) =>
      upstream.fetch(input, init)) satisfies HttpFetch);
  });

  beforeEach(() => {
    upstream = new FakeOpenMeteo();
    upstream.geocoding[SENTINEL.toLowerCase()] = () => jsonResponse(NO_MATCH);
  });

  afterEach(() => {
    expect(upstream.misses).toEqual([]);
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['an unterminated string', `{"query": "${SENTINEL}`],
    ['a bare word', SENTINEL],
    [
      'an object with a trailing comma',
      `{"query": "{ health }", "variables": {"city": "${SENTINEL}"},}`,
    ],
  ])('answers a malformed JSON body (%s) with 400 and a fixed message', async (_name, body) => {
    const response = await postRaw(body);

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.body).toEqual({
      errors: [
        { message: 'The request body is not valid JSON.', extensions: { code: 'BAD_REQUEST' } },
      ],
    });
    expectNoSentinel(response.text);
    expect(response.text).not.toMatch(/position|token|Unexpected|Unterminated|at .*\.js/);
  });

  it('answers an unsupported body charset with 415 without echoing the header', async () => {
    const response = await postRaw('{}', `application/json; charset=${SENTINEL}`);

    expect(response.status).toBe(415);
    expect(response.body).toEqual({
      errors: [
        {
          message: 'The request body charset is not supported.',
          extensions: { code: 'BAD_REQUEST' },
        },
      ],
    });
    expectNoSentinel(response.text);
  });

  it.each([
    [
      'a list for a String field',
      FORECAST_QUERY,
      { input: { city: [SENTINEL] } },
      'input',
      'ForecastInput!',
    ],
    [
      'an object for a String field',
      FORECAST_QUERY,
      { input: { countryCode: { [SENTINEL]: SENTINEL_ID } } },
      'input',
      'ForecastInput!',
    ],
    [
      'an undeclared input field',
      FORECAST_QUERY,
      { input: { city: 'Peniche', [SENTINEL]: SENTINEL_ID } },
      'input',
      'ForecastInput!',
    ],
    ['a missing required variable', FORECAST_QUERY, {}, 'input', 'ForecastInput!'],
    [
      'a number for a String! variable',
      LOCATIONS_QUERY,
      { city: Number(SENTINEL_ID) },
      'city',
      'String!',
    ],
    ['null for a String! variable', LOCATIONS_QUERY, { city: null }, 'city', 'String!'],
    [
      'a list for an optional String variable',
      LOCATIONS_QUERY,
      { city: 'Peniche', countryCode: [SENTINEL] },
      'countryCode',
      'String',
    ],
  ])(
    'answers a variable coercion error (%s) with 400, BAD_USER_INPUT and a fixed message',
    async (_name, query, variables, variable, type) => {
      const response = await postRaw({ query, variables });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        errors: [
          {
            message: `Variable "$${variable}" is missing or does not match type "${type}".`,
            locations: [expect.objectContaining({ line: 2 })],
            extensions: { code: 'BAD_USER_INPUT' },
          },
        ],
      });
      expectNoSentinel(response.text);
      expect(upstream.calls.geocoding).toBe(0);
    },
  );

  it('keeps the field metadata and 200 status of a domain BAD_USER_INPUT error', async () => {
    const response = await postRaw({
      query: FORECAST_QUERY,
      variables: { input: { city: `${SENTINEL}\u0000` } },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: null,
      errors: [
        {
          message: 'city must not contain control characters.',
          locations: expect.any(Array),
          path: ['activityForecast'],
          extensions: { code: 'BAD_USER_INPUT', field: 'city' },
        },
      ],
    });
    expectNoSentinel(response.text);

    const both = await postGraphQL(app, FORECAST_QUERY, {
      input: { city: SENTINEL, locationId: SENTINEL_ID },
    });
    expect(both.errors?.[0].extensions).toEqual({ code: 'BAD_USER_INPUT', field: null });
  });

  it('answers an unknown city with a LocationNotFound message that omits the search', async () => {
    const response = await postRaw({
      query: FORECAST_QUERY,
      variables: { input: { city: ` ${SENTINEL} `, countryCode: 'zz' } },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        activityForecast: {
          __typename: 'LocationNotFound',
          message: 'No location matches the city search.',
        },
      },
    });
    expectNoSentinel(response.text);
    expect(response.text).not.toMatch(/\bZZ\b/i);
    expect(upstream.calls.geocoding).toBe(1);
  });

  it('answers an unknown stored ID with a LocationNotFound message that omits the ID', async () => {
    const response = await postRaw({
      query: FORECAST_QUERY,
      variables: { input: { locationId: SENTINEL_ID } },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        activityForecast: {
          __typename: 'LocationNotFound',
          message: 'No stored location has the given ID.',
        },
      },
    });
    expectNoSentinel(response.text);
    expect(upstream.calls.geocoding).toBe(0);
  });

  it('still answers valid queries with their typed results', async () => {
    await expect(postForecast(app, { city: 'Peniche' })).resolves.toMatchObject({
      __typename: 'ActivityForecast',
      location: { id: '2264508' },
    });
    await expect(postForecast(app, { city: 'Springfield' })).resolves.toMatchObject({
      __typename: 'AmbiguousLocation',
    });
    await expect(postGraphQL(app, LOCATIONS_QUERY, { city: 'Warsaw' })).resolves.toEqual({
      data: { locations: [expect.objectContaining({ name: 'Warsaw' })] },
    });
  });

  it('allows introspection for local development and the contract tests', async () => {
    await expect(postGraphQL(app, '{ __schema { queryType { name } } }', {})).resolves.toEqual({
      data: { __schema: { queryType: { name: 'Query' } } },
    });
  });

  it('answers a parse error with 400 and a fixed message that keeps the location', async () => {
    const response = await postRaw({ query: `{ locations(city: "${SENTINEL}" ` });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: [
        {
          message: 'The query is not valid GraphQL syntax.',
          locations: [expect.objectContaining({ line: 1 })],
          extensions: { code: 'GRAPHQL_PARSE_FAILED' },
        },
      ],
    });
    expectNoSentinel(response.text);
  });

  it.each([
    ['a number for a String argument', `{ locations(city: ${SENTINEL_ID}) { id } }`],
    ['a string for an input object', `{ activityForecast(input: "${SENTINEL}") { __typename } }`],
    ['an undeclared input field', `{ activityForecast(input: { ${SENTINEL}: 1 }) { __typename } }`],
  ])(
    'answers a validation error on an input literal (%s) with a fixed message',
    async (_name, query) => {
      const response = await postRaw({ query });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        errors: [
          {
            message: 'An input value in the query does not match its expected type.',
            locations: [expect.objectContaining({ line: 1 })],
            extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
          },
        ],
      });
      expectNoSentinel(response.text);
    },
  );

  it('keeps the message of a validation error about a name', async () => {
    const response = await postRaw({ query: '{ unknownField }' });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        message: 'Cannot query field "unknownField" on type "Query".',
        extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
      }),
    ]);
  });

  it('answers an unknown operationName with a fixed message', async () => {
    const response = await postRaw({
      query: LOCATIONS_QUERY,
      variables: { city: 'Warsaw' },
      operationName: SENTINEL,
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: [
        {
          message: 'Set operationName to the name of one operation in the query.',
          extensions: { code: 'OPERATION_RESOLUTION_FAILURE' },
        },
      ],
    });
    expectNoSentinel(response.text);
  });

  it('reports more than 50 variable errors as BAD_USER_INPUT only', async () => {
    const input = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [`${SENTINEL}${index}`, SENTINEL_ID]),
    );

    const response = await postRaw({ query: FORECAST_QUERY, variables: { input } });

    expect(response.status).toBe(400);
    const errors = (response.body as { errors: { message: string; extensions: object }[] }).errors;
    expect(errors).toHaveLength(51);
    expect(new Set(errors.map((error) => JSON.stringify(error.extensions)))).toEqual(
      new Set([JSON.stringify({ code: 'BAD_USER_INPUT' })]),
    );
    expect(errors[50].message).toBe('Too many invalid variables; the rest were not checked.');
    expectNoSentinel(response.text);
  });

  it('answers an unknown route with 404 without echoing the path', async () => {
    const response = await request(app.getHttpServer())
      .post(`/${SENTINEL}?id=${SENTINEL_ID}`)
      .send({ query: '{ __typename }' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      message: 'No route matches the request.',
      error: 'Not Found',
      statusCode: 404,
    });
    expectNoSentinel(response.text);
  });
});
