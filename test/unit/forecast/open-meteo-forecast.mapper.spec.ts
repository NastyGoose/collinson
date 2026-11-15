import {
  atmosphericBody,
  clonePayload,
  marineBody,
  PENICHE,
  WARSAW,
  type Payload,
} from '../../fixtures/open-meteo-weather';
import { thrown } from '../../support/errors';
import { SourceRefreshError } from '../../../src/forecast/forecast.errors';
import { ATMOSPHERIC_SPEC, MARINE_SPEC } from '../../../src/forecast/forecast.constants';
import { parseForecastResponse } from '../../../src/forecast/open-meteo-forecast.mapper';

const FIRST_HOUR = '2026-11-14T00:00:00Z';

function parseError(body: unknown, spec = ATMOSPHERIC_SPEC): SourceRefreshError {
  return thrown(() => parseForecastResponse(body, spec, PENICHE), SourceRefreshError);
}

describe('parseForecastResponse', () => {
  it('keeps nulls and zeros exactly as the provider sent them', () => {
    const body = clonePayload(atmosphericBody({ firstHour: FIRST_HOUR }));
    body.hourly.temperature_2m[10] = null;
    body.hourly.snow_depth[10] = 0;
    body.hourly.precipitation[11] = -0.1;

    const forecast = parseForecastResponse(body, ATMOSPHERIC_SPEC, PENICHE);

    expect(forecast.hourly.series.temperature_2m[10]).toBeNull();
    expect(forecast.hourly.series.snow_depth[10]).toBe(0);
    // Negative values are stored as sent; scoring treats them as missing.
    expect(forecast.hourly.series.precipitation[11]).toBe(-0.1);
  });

  it('accepts a marine payload whose waves are entirely null', () => {
    const forecast = parseForecastResponse(
      marineBody({ firstHour: FIRST_HOUR, waves: 'null' }),
      MARINE_SPEC,
      WARSAW,
    );

    expect(forecast.hourly.time).toHaveLength(192);
    expect(forecast.hourly.series.wave_height.every((value) => value === null)).toBe(true);
    expect(forecast.hourly.series.wave_period.every((value) => value === null)).toBe(true);
  });

  it('drops variables it did not request', () => {
    const body = clonePayload(marineBody({ firstHour: FIRST_HOUR }));
    body.hourly.swell_wave_height = body.hourly.wave_height;

    const forecast = parseForecastResponse(body, MARINE_SPEC, PENICHE);

    expect(Object.keys(forecast.hourly.series)).toEqual(['wave_height', 'wave_period']);
  });

  it.each([
    ['a non-object body', () => []],
    ['missing returned coordinates', (body) => ({ ...body, latitude: undefined })],
    ['out-of-range coordinates', (body) => ({ ...body, longitude: 181 })],
    ['missing hourly_units', (body) => ({ ...body, hourly_units: undefined })],
    [
      'ISO timestamps',
      (body) => ({ ...body, hourly_units: { ...body.hourly_units, time: 'iso8601' } }),
    ],
    ['wind in mph', (body) => withUnit(body, 'wind_speed_10m', 'mp/h')],
    ['temperature in °F', (body) => withUnit(body, 'temperature_2m', '°F')],
    ['snow depth in cm', (body) => withUnit(body, 'snow_depth', 'cm')],
    ['precipitation in inches', (body) => withUnit(body, 'precipitation', 'inch')],
    ['missing hourly', (body) => ({ ...body, hourly: undefined })],
    ['empty timestamps', (body) => withSeries(body, 'time', [])],
    ['string timestamps', (body) => withSeries(body, 'time', mapSeries(body, 'time', String))],
    [
      'decreasing timestamps',
      (body) => withSeries(body, 'time', mapSeries(body, 'time').reverse()),
    ],
    ['a duplicated timestamp', (body) => withSeries(body, 'time', duplicateFirst(body, 'time'))],
    ['a timestamp beyond the Date range', (body) => withSeries(body, 'time', withLast(body, 9e12))],
    [
      'a timestamp off the minute',
      (body) => withSeries(body, 'time', withLast(body, 1794614401 + 191 * 3600)),
    ],
    ['a missing series', (body) => withSeries(body, 'precipitation', undefined)],
    [
      'a short series',
      (body) => withSeries(body, 'precipitation', mapSeries(body, 'precipitation').slice(1)),
    ],
    [
      'a string measurement',
      (body) => withSeries(body, 'temperature_2m', mapSeries(body, 'temperature_2m', String)),
    ],
  ] satisfies Array<[string, (body: Payload) => unknown]>)('rejects %s', (_label, corrupt) => {
    const body = clonePayload(atmosphericBody({ firstHour: FIRST_HOUR }));

    const error = parseError(corrupt(body));

    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.message).toMatch(/^Atmospheric forecast payload is invalid: /);
  });

  it.each([
    ['wave_height', 'ft'],
    ['wave_period', 'min'],
  ])('rejects marine %s in %s without echoing the provider unit', (variable, unit) => {
    const body = clonePayload(marineBody({ firstHour: FIRST_HOUR }));
    body.hourly_units[variable] = unit;

    const error = parseError(body, MARINE_SPEC);

    expect(error.message).toContain(variable);
    expect(error.message).not.toContain(unit);
  });

  it('reports the provider error envelope as an upstream failure', () => {
    const error = parseError({ error: true, reason: 'internal detail' });

    expect(error.code).toBe('UPSTREAM_FAILURE');
    expect(error.cause).toBe('internal detail');
    expect(error.message).not.toContain('internal detail');
  });
});

function withUnit(body: Payload, variable: string, unit: string): Payload {
  return { ...body, hourly_units: { ...body.hourly_units, [variable]: unit } };
}

/** The payload with one hourly series replaced, or removed when `values` is undefined. */
function withSeries(body: Payload, variable: string, values: unknown[] | undefined): Payload {
  const hourly = { ...body.hourly };
  if (values === undefined) {
    delete hourly[variable];
  } else {
    hourly[variable] = values;
  }
  return { ...body, hourly };
}

function withLast(body: Payload, time: number): unknown[] {
  const times = [...body.hourly.time];
  times[times.length - 1] = time;
  return times;
}

function mapSeries(body: Payload, variable: string, map: (value: unknown) => unknown = (v) => v) {
  return body.hourly[variable].map(map);
}

function duplicateFirst(body: Payload, variable: string): unknown[] {
  const values = [...body.hourly[variable]];
  values[1] = values[0];
  return values;
}
