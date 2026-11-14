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
  type RawResult,
} from '../../test/fixtures/open-meteo-geocoding';
import { fixtureFetch, jsonResponse, timeoutError } from '../../test/support/fixture-fetch';
import { GeocodingUnavailableError } from './location.errors';
import {
  GEOCODING_REQUEST_COUNT,
  OpenMeteoGeocodingClient,
  parseGeocodingResponse,
} from './open-meteo-geocoding.client';

async function geocodingError(promise: Promise<unknown>): Promise<GeocodingUnavailableError> {
  const error: unknown = await promise.then(
    () => undefined,
    (rejection: unknown) => rejection,
  );
  if (!(error instanceof GeocodingUnavailableError)) {
    throw new Error(`expected a GeocodingUnavailableError, got ${String(error)}`);
  }
  return error;
}

function syncGeocodingError(run: () => unknown): GeocodingUnavailableError {
  try {
    run();
  } catch (error) {
    if (error instanceof GeocodingUnavailableError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a GeocodingUnavailableError');
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

  it.each([
    ['a timeout', () => Promise.reject(timeoutError()), 'TIMEOUT'],
    ['a network error', () => Promise.reject(new TypeError('fetch failed')), 'NETWORK'],
    ['HTTP 503', () => Promise.resolve(jsonResponse({}, 503)), 'UPSTREAM_FAILURE'],
  ] as const)('fails after two attempts on %s', async (_label, reply, kind) => {
    const fetch = fixtureFetch(reply);

    const error = await geocodingError(new OpenMeteoGeocodingClient(fetch).search('Berlin', null));

    expect(error.kind).toBe(kind);
    expect(error.code).toBe('GEOCODING_UNAVAILABLE');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['HTTP 429', () => jsonResponse({}, 429), 'RATE_LIMITED'],
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

describe('parseGeocodingResponse', () => {
  it.each([
    ['no results key', NO_MATCH],
    ['an empty results array', resultsBody()],
  ])('treats %s as a genuine no-match', (_label, body) => {
    expect(parseGeocodingResponse(body, null)).toEqual([]);
  });

  it.each([
    ['a non-object body', []],
    ['a null body', null],
    ['results that is not an array', { results: {} }],
  ])('rejects %s as an invalid payload', (_label, body) => {
    expect(syncGeocodingError(() => parseGeocodingResponse(body, null)).kind).toBe(
      'INVALID_PAYLOAD',
    );
  });

  it('rejects the error envelope even on HTTP 200', () => {
    const error = syncGeocodingError(() => parseGeocodingResponse(PROVIDER_ERROR, null));

    expect(error.kind).toBe('UPSTREAM_FAILURE');
    expect(error.message).toContain('count must be between 1 and 100');
  });

  it.each<[string, RawResult]>([
    ['a missing time zone', { ...BERLIN_DE, timezone: undefined }],
    ['a blank time zone', { ...BERLIN_DE, timezone: ' ' }],
    ['an unknown time zone', { ...BERLIN_DE, timezone: 'Mars/Olympus_Mons' }],
    ['a missing latitude', { ...BERLIN_DE, latitude: undefined }],
    ['a latitude out of range', { ...BERLIN_DE, latitude: 90.5 }],
    ['a longitude out of range', { ...BERLIN_DE, longitude: -180.1 }],
    ['a string coordinate', { ...BERLIN_DE, longitude: '13.4' }],
    ['a missing ID', { ...BERLIN_DE, id: undefined }],
    ['a fractional ID', { ...BERLIN_DE, id: 1.5 }],
    ['a zero ID', { ...BERLIN_DE, id: 0 }],
    ['a string ID', { ...BERLIN_DE, id: '2950159' }],
    ['a blank name', { ...BERLIN_DE, name: '' }],
    ['a missing country', { ...BERLIN_DE, country: undefined }],
  ])('drops a candidate with %s', (_label, invalid) => {
    expect(parseGeocodingResponse(resultsBody(invalid, SPRINGFIELD_IL), null)).toEqual([
      expect.objectContaining({ id: '4250542' }),
    ]);
  });

  it('never defaults a missing time zone or coordinates: wholly unusable results fail', () => {
    const body = resultsBody(
      { ...BERLIN_DE, timezone: undefined },
      { ...SPRINGFIELD_IL, latitude: null },
    );

    expect(syncGeocodingError(() => parseGeocodingResponse(body, null)).kind).toBe(
      'UNUSABLE_RESULTS',
    );
  });

  it('keeps zero coordinates, which are valid', () => {
    const nullIsland = { ...BERLIN_DE, id: 1, latitude: 0, longitude: 0, timezone: 'Etc/UTC' };

    expect(parseGeocodingResponse(resultsBody(nullIsland), null)[0]).toMatchObject({
      latitude: 0,
      longitude: 0,
    });
  });

  it('reports a missing region as null', () => {
    const [location] = parseGeocodingResponse(
      resultsBody({ ...BERLIN_DE, admin1: undefined }),
      null,
    );

    expect(location.region).toBeNull();
  });

  it('drops duplicate IDs, keeping the first', () => {
    const body = resultsBody(SPRINGFIELD_MO, { ...SPRINGFIELD_MO, name: 'Dup' }, SPRINGFIELD_IL);

    expect(parseGeocodingResponse(body, null).map(({ id, name }) => [id, name])).toEqual([
      ['4409896', 'Springfield'],
      ['4250542', 'Springfield'],
    ]);
  });

  it('caps the candidates at five valid ones, skipping invalid entries', () => {
    const results = [
      { ...BERLIN_DE, id: 1, timezone: undefined },
      ...Array.from({ length: 7 }, (_, index) => ({ ...BERLIN_DE, id: 100 + index })),
    ];

    expect(parseGeocodingResponse(resultsBody(...results), null).map((l) => l.id)).toEqual([
      '100',
      '101',
      '102',
      '103',
      '104',
    ]);
  });

  it('drops candidates outside the requested country', () => {
    const body = resultsBody(BERLIN_DE, SPRINGFIELD_IL);

    expect(parseGeocodingResponse(body, 'US').map((location) => location.id)).toEqual(['4250542']);
  });

  it('fails when the provider ignored the country filter for every result', () => {
    const body = resultsBody(BERLIN_DE, SPRINGFIELD_IL);

    expect(syncGeocodingError(() => parseGeocodingResponse(body, 'FR')).kind).toBe(
      'UNUSABLE_RESULTS',
    );
  });
});
