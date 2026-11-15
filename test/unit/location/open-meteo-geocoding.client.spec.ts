import { Logger } from '@nestjs/common';
import {
  BERLIN_DE,
  NO_MATCH,
  PROVIDER_ERROR,
  resultsBody,
  SAO_PAULO_BR,
  SPRINGFIELD_IL,
  SPRINGFIELD_MA,
  SPRINGFIELD_MO,
} from '../../fixtures/open-meteo-geocoding';
import { rejected } from '../../support/errors';
import { fixtureFetch, jsonResponse, timeoutError } from '../../support/fixture-fetch';
import { GeocodingUnavailableError } from '../../../src/location/location.errors';
import {
  GEOCODING_REQUEST_COUNT,
  GEOCODING_TIMEOUT_MS,
} from '../../../src/location/location.constants';
import { OpenMeteoGeocodingClient } from '../../../src/location/open-meteo-geocoding.client';

function geocodingError(promise: Promise<unknown>): Promise<GeocodingUnavailableError> {
  return rejected(promise, GeocodingUnavailableError);
}

describe('OpenMeteoGeocodingClient', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('requests the bounded search with the country filter', async () => {
    const fetch = fixtureFetch(() => jsonResponse(resultsBody(SAO_PAULO_BR)));

    await new OpenMeteoGeocodingClient(fetch).search('São Paulo', 'BR');

    const url = fetch.mock.calls[0][0];
    expect(url.origin + url.pathname).toBe('https://geocoding-api.open-meteo.com/v1/search');
    expect(url.searchParams.get('name')).toBe('São Paulo');
    expect(url.searchParams.get('count')).toBe(String(GEOCODING_REQUEST_COUNT));
    expect(url.searchParams.get('countryCode')).toBe('BR');
    expect(url.searchParams.get('format')).toBe('json');
    expect(fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('limits each attempt to five seconds', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    const fetch = fixtureFetch(() => jsonResponse(NO_MATCH));

    await new OpenMeteoGeocodingClient(fetch).search('Berlin', null);

    expect(GEOCODING_TIMEOUT_MS).toBe(5000);
    expect(timeout).toHaveBeenCalledWith(5000);
    timeout.mockRestore();
  });

  it('omits countryCode for an unfiltered search', async () => {
    const fetch = fixtureFetch(() => jsonResponse(NO_MATCH));

    await new OpenMeteoGeocodingClient(fetch).search('Berlin', null);

    expect(fetch.mock.calls[0][0].searchParams.has('countryCode')).toBe(false);
  });

  it('maps a unique match to a location with a stable ID', async () => {
    const fetch = fixtureFetch(() => jsonResponse(resultsBody(SAO_PAULO_BR)));

    await expect(new OpenMeteoGeocodingClient(fetch).search('São Paulo', null)).resolves.toEqual([
      {
        id: '3448439',
        name: 'São Paulo',
        country: 'Brazil',
        region: 'São Paulo',
        latitude: -23.5475,
        longitude: -46.63611,
        timezone: 'America/Sao_Paulo',
      },
    ]);
  });

  it('keeps the provider order for an ambiguous name', async () => {
    const fetch = fixtureFetch(() =>
      jsonResponse(resultsBody(SPRINGFIELD_MO, SPRINGFIELD_IL, SPRINGFIELD_MA)),
    );

    const candidates = await new OpenMeteoGeocodingClient(fetch).search('Springfield', null);

    expect(candidates.map((candidate) => candidate.id)).toEqual(['4409896', '4250542', '4951788']);
  });

  it('returns an empty list for a genuine no-match', async () => {
    const fetch = fixtureFetch(() => jsonResponse(NO_MATCH));

    await expect(new OpenMeteoGeocodingClient(fetch).search('Zzqxqxq', null)).resolves.toEqual([]);
  });

  it('retries once after a timeout and then succeeds', async () => {
    let attempt = 0;
    const fetch = fixtureFetch(() => {
      attempt += 1;
      if (attempt === 1) {
        throw timeoutError();
      }
      return jsonResponse(resultsBody(BERLIN_DE));
    });

    const candidates = await new OpenMeteoGeocodingClient(fetch).search('Berlin', 'DE');

    expect(candidates).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports the second failure when the retry fails differently', async () => {
    let attempt = 0;
    const fetch = fixtureFetch(() => {
      attempt += 1;
      if (attempt === 1) {
        throw timeoutError();
      }
      return jsonResponse({}, 503);
    });

    const error = await geocodingError(new OpenMeteoGeocodingClient(fetch).search('Berlin', null));

    expect(error.kind).toBe('UPSTREAM_FAILURE');
    expect(error.message).toContain('HTTP 503');
  });

  it.each([
    ['a timeout', () => Promise.reject(timeoutError()), 'TIMEOUT'],
    ['a network error', () => Promise.reject(new TypeError('fetch failed')), 'NETWORK'],
    ['HTTP 503', () => Promise.resolve(jsonResponse({}, 503)), 'UPSTREAM_FAILURE'],
    ['HTTP 500', () => Promise.resolve(jsonResponse({}, 500)), 'UPSTREAM_FAILURE'],
  ] as const)('fails after two attempts on %s', async (_label, reply, kind) => {
    const fetch = fixtureFetch(reply);

    const error = await geocodingError(new OpenMeteoGeocodingClient(fetch).search('Berlin', null));

    expect(error.kind).toBe(kind);
    expect(error.code).toBe('GEOCODING_UNAVAILABLE');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['HTTP 429', () => jsonResponse({}, 429), 'RATE_LIMITED'],
    ['HTTP 404', () => jsonResponse({}, 404), 'UPSTREAM_FAILURE'],
    [
      'HTTP 400 with the error envelope',
      () => jsonResponse(PROVIDER_ERROR, 400),
      'UPSTREAM_FAILURE',
    ],
    ['invalid JSON', () => new Response('<html>busy</html>', { status: 200 }), 'INVALID_PAYLOAD'],
  ] as const)('fails without retrying on %s', async (_label, reply, kind) => {
    const fetch = fixtureFetch(reply);

    const error = await geocodingError(new OpenMeteoGeocodingClient(fetch).search('Berlin', null));

    expect(error.kind).toBe(kind);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
