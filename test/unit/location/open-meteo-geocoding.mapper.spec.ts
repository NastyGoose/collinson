import {
  BERLIN_DE,
  NO_MATCH,
  PROVIDER_ERROR,
  resultsBody,
  SPRINGFIELD_IL,
  SPRINGFIELD_MO,
  type RawResult,
} from '../../fixtures/open-meteo-geocoding';
import { thrown } from '../../support/errors';
import { GeocodingUnavailableError } from '../../../src/location/location.errors';
import { parseGeocodingResponse } from '../../../src/location/open-meteo-geocoding.mapper';

function syncGeocodingError(run: () => unknown): GeocodingUnavailableError {
  return thrown(run, GeocodingUnavailableError);
}

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

  it('rejects the error envelope even on HTTP 200, keeping the reason out of the message', () => {
    const error = syncGeocodingError(() => parseGeocodingResponse(PROVIDER_ERROR, null));

    expect(error.kind).toBe('UPSTREAM_FAILURE');
    expect(error.message).toBe('Geocoding reported an error.');
    expect(error.cause).toBe('Parameter count must be between 1 and 100.');
  });

  it.each<[string, RawResult]>([
    ['a missing time zone', { ...BERLIN_DE, timezone: undefined }],
    ['a blank time zone', { ...BERLIN_DE, timezone: ' ' }],
    ['an unknown time zone', { ...BERLIN_DE, timezone: 'Mars/Olympus_Mons' }],
    ['a UTC offset instead of a time zone name', { ...BERLIN_DE, timezone: '+01:00' }],
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

  it('fails on wholly unusable results instead of defaulting a time zone or coordinates', () => {
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
