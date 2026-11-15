import { Logger } from '@nestjs/common';
import {
  atmosphericBody,
  clonePayload,
  marineBody,
  PENICHE,
  WARSAW,
  type Payload,
} from '../../fixtures/open-meteo-weather';
import { rejected, thrown } from '../../support/errors';
import { fixtureFetch, jsonResponse, timeoutError } from '../../support/fixture-fetch';
import { MAX_RESPONSE_BYTES } from '../../../src/http/json-request';
import { SourceRefreshError } from '../../../src/forecasts/forecast.errors';
import {
  ATMOSPHERIC_SPEC,
  OpenMeteoAtmosphericClient,
} from '../../../src/forecasts/open-meteo-atmospheric.client';
import {
  FORECAST_DAYS_REQUESTED,
  OPEN_METEO_TIMEOUT_MS,
  parseForecastResponse,
} from '../../../src/forecasts/open-meteo-forecast';
import {
  MARINE_SPEC,
  OpenMeteoMarineClient,
} from '../../../src/forecasts/open-meteo-marine.client';

const FIRST_HOUR = '2026-11-14T00:00:00Z';

function refreshError(promise: Promise<unknown>): Promise<SourceRefreshError> {
  return rejected(promise, SourceRefreshError);
}

function parseError(body: unknown, spec = ATMOSPHERIC_SPEC): SourceRefreshError {
  return thrown(() => parseForecastResponse(body, spec, PENICHE), SourceRefreshError);
}

/** Answers each attempt with the next entry: a body, an HTTP status with a body, or an error. */
function sequence(...answers: Array<Response | Error>) {
  let attempt = 0;
  return fixtureFetch(() => {
    const answer = answers[Math.min(attempt, answers.length - 1)];
    attempt += 1;
    // Not `instanceof Error`: the timeout DOMException comes from another realm under Jest.
    if (!(answer instanceof Response)) {
      throw answer;
    }
    return answer.clone();
  });
}

let warn: jest.SpyInstance;

beforeAll(() => {
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('Open-Meteo forecast requests', () => {
  it('asks the forecast API for eight days of metric hourly weather in Unix time', async () => {
    const fetch = fixtureFetch(() => jsonResponse(atmosphericBody({ firstHour: FIRST_HOUR })));

    await new OpenMeteoAtmosphericClient(fetch).fetchForecast(PENICHE);

    const url = fetch.mock.calls[0][0];
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: '39.3558',
      longitude: '-9.38112',
      hourly: 'temperature_2m,snow_depth,precipitation,wind_speed_10m',
      forecast_days: String(FORECAST_DAYS_REQUESTED),
      timezone: 'Europe/Lisbon',
      timeformat: 'unixtime',
      temperature_unit: 'celsius',
      wind_speed_unit: 'kmh',
      precipitation_unit: 'mm',
    });
  });

  it('asks the marine API for the sea cell with wave height and period', async () => {
    const fetch = fixtureFetch(() => jsonResponse(marineBody({ firstHour: FIRST_HOUR })));

    await new OpenMeteoMarineClient(fetch).fetchForecast(WARSAW);

    const url = fetch.mock.calls[0][0];
    expect(url.origin + url.pathname).toBe('https://marine-api.open-meteo.com/v1/marine');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: '52.22977',
      longitude: '21.01178',
      hourly: 'wave_height,wave_period',
      forecast_days: '8',
      timezone: 'Europe/Warsaw',
      timeformat: 'unixtime',
      cell_selection: 'sea',
      length_unit: 'metric',
    });
  });

  it('limits each attempt to five seconds', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    const fetch = fixtureFetch(() => jsonResponse(marineBody({ firstHour: FIRST_HOUR })));

    await new OpenMeteoMarineClient(fetch).fetchForecast(PENICHE);

    expect(OPEN_METEO_TIMEOUT_MS).toBe(5000);
    expect(timeout).toHaveBeenCalledWith(OPEN_METEO_TIMEOUT_MS);
    expect(fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });

  it('aborts a stalled attempt at the limit and retries it once', async () => {
    const controllers: AbortController[] = [];
    const timeout = jest.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController();
      controllers.push(controller);
      return controller.signal;
    });
    // Each attempt waits on its signal, as fetch does, and never answers on its own.
    const fetch = fixtureFetch();
    fetch.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );

    const pending = refreshError(new OpenMeteoMarineClient(fetch).fetchForecast(PENICHE));
    // Fire each attempt's timer as AbortSignal.timeout would after 5000 ms.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      while (controllers.length <= attempt) {
        await Promise.resolve();
      }
      controllers[attempt].abort(timeoutError());
    }
    const error = await pending;

    expect(timeout).toHaveBeenNthCalledWith(2, OPEN_METEO_TIMEOUT_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(error.code).toBe('TIMEOUT');
    timeout.mockRestore();
  });

  it('normalizes the answer with requested and returned coordinates', async () => {
    const fetch = fixtureFetch(() => jsonResponse(atmosphericBody({ firstHour: FIRST_HOUR })));

    const forecast = await new OpenMeteoAtmosphericClient(fetch).fetchForecast(PENICHE);

    expect(forecast).toMatchObject({
      source: 'ATMOSPHERIC',
      schemaVersion: 1,
      requested: { latitude: 39.3558, longitude: -9.38112 },
      returned: { latitude: 39.371773, longitude: -9.33009 },
      timezone: 'Europe/Lisbon',
      units: { temperature_2m: '°C', snow_depth: 'm', precipitation: 'mm', wind_speed_10m: 'km/h' },
      coverageStart: new Date(FIRST_HOUR),
      coverageEnd: new Date('2026-11-21T23:00:00Z'),
    });
    expect(forecast.hourly.time).toHaveLength(192);
    expect(Object.keys(forecast.hourly.series)).toEqual([
      'temperature_2m',
      'snow_depth',
      'precipitation',
      'wind_speed_10m',
    ]);
  });
});

describe('Open-Meteo forecast retries', () => {
  const body = () => jsonResponse(atmosphericBody({ firstHour: FIRST_HOUR }));

  it('retries once after a timeout and then succeeds', async () => {
    const fetch = sequence(timeoutError(), body());

    await new OpenMeteoAtmosphericClient(fetch).fetchForecast(PENICHE);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries once after a network error and reports the second failure', async () => {
    const fetch = sequence(new TypeError('fetch failed'), timeoutError());

    const error = await refreshError(new OpenMeteoAtmosphericClient(fetch).fetchForecast(PENICHE));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(error.code).toBe('TIMEOUT');
    expect(error.message).toBe('Atmospheric forecast did not answer within 5000 ms.');
  });

  it('retries a 5xx once and gives up after the second', async () => {
    const fetch = sequence(jsonResponse({}, 502), jsonResponse({}, 503), body());

    const error = await refreshError(new OpenMeteoMarineClient(fetch).fetchForecast(PENICHE));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(error.code).toBe('UPSTREAM_FAILURE');
    expect(error.message).toBe('Marine forecast answered HTTP 503.');
  });

  it('does not retry a rate limit', async () => {
    const fetch = sequence(jsonResponse({}, 429), body());

    const error = await refreshError(new OpenMeteoAtmosphericClient(fetch).fetchForecast(PENICHE));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error.code).toBe('RATE_LIMITED');
  });

  it('does not retry a 4xx, and keeps the provider reason out of the message', async () => {
    const fetch = sequence(jsonResponse({ error: true, reason: 'Cannot initialize bogus' }, 400));

    const error = await refreshError(new OpenMeteoMarineClient(fetch).fetchForecast(PENICHE));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error.code).toBe('UPSTREAM_FAILURE');
    expect(error.message).not.toContain('bogus');
  });

  it('logs provider text cut short and without control characters', async () => {
    warn.mockClear();
    const fetch = sequence(
      new Response(`line one\nFORGED LOG LINE\u001b[31m${'x'.repeat(500)}`, { status: 404 }),
    );

    await refreshError(new OpenMeteoAtmosphericClient(fetch).fetchForecast(PENICHE));

    const logged = String(warn.mock.calls.at(-1)?.[0]);
    expect(logged).toContain('line one FORGED LOG LINE');
    expect(/\p{Cc}/u.test(logged)).toBe(false);
    expect(logged.length).toBeLessThan(300);
  });

  it('rejects an oversized answer without retrying', async () => {
    const fetch = sequence(new Response(' '.repeat(MAX_RESPONSE_BYTES + 1), { status: 200 }));

    const error = await refreshError(new OpenMeteoMarineClient(fetch).fetchForecast(PENICHE));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.message).toBe(
      `Marine forecast answered with more than ${MAX_RESPONSE_BYTES} bytes.`,
    );
  });

  it('does not retry an invalid payload', async () => {
    const fetch = sequence(new Response('<html>', { status: 200 }), body());

    const error = await refreshError(new OpenMeteoAtmosphericClient(fetch).fetchForecast(PENICHE));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error.code).toBe('INVALID_PAYLOAD');
  });
});

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
