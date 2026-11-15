import {
  atmosphericBody,
  FIRST_HOUR,
  marineBody,
  PENICHE,
  WARSAW,
} from '../../fixtures/open-meteo-weather';
import { rejected } from '../../support/errors';
import { fixtureFetch, jsonResponse, timeoutError } from '../../support/fixture-fetch';
import { jsonRequest } from '../../support/json-request';
import { silentLogger } from '../../support/logger';
import { MAX_RESPONSE_BYTES } from '../../../src/http/http.constants';
import { SourceRefreshError } from '../../../src/forecast/forecast.errors';
import {
  FORECAST_DAYS_REQUESTED,
  OPEN_METEO_TIMEOUT_MS,
} from '../../../src/forecast/forecast.constants';
import { OpenMeteoAtmosphericClient } from '../../../src/forecast/open-meteo-atmospheric.client';
import { OpenMeteoMarineClient } from '../../../src/forecast/open-meteo-marine.client';

function refreshError(promise: Promise<unknown>): Promise<SourceRefreshError> {
  return rejected(promise, SourceRefreshError);
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

/** JsonRequestService logs request failures; this spy reads what it logged. */
const requestLogger = silentLogger();
const warn = jest.spyOn(requestLogger, 'warn');

describe('Open-Meteo forecast requests', () => {
  it('asks the forecast API for eight days of metric hourly weather in Unix time', async () => {
    const fetch = fixtureFetch(() => jsonResponse(atmosphericBody({ firstHour: FIRST_HOUR })));

    await new OpenMeteoAtmosphericClient(
      jsonRequest(fetch, requestLogger),
      silentLogger(),
    ).fetchForecast(PENICHE);

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

    await new OpenMeteoMarineClient(
      jsonRequest(fetch, requestLogger),
      silentLogger(),
    ).fetchForecast(WARSAW);

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

    await new OpenMeteoMarineClient(
      jsonRequest(fetch, requestLogger),
      silentLogger(),
    ).fetchForecast(PENICHE);

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

    const pending = refreshError(
      new OpenMeteoMarineClient(jsonRequest(fetch, requestLogger), silentLogger()).fetchForecast(
        PENICHE,
      ),
    );
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

    const forecast = await new OpenMeteoAtmosphericClient(
      jsonRequest(fetch, requestLogger),
      silentLogger(),
    ).fetchForecast(PENICHE);

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

    await new OpenMeteoAtmosphericClient(
      jsonRequest(fetch, requestLogger),
      silentLogger(),
    ).fetchForecast(PENICHE);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries once after a network error and reports the second failure', async () => {
    const fetch = sequence(new TypeError('fetch failed'), timeoutError());

    const error = await refreshError(
      new OpenMeteoAtmosphericClient(
        jsonRequest(fetch, requestLogger),
        silentLogger(),
      ).fetchForecast(PENICHE),
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(error.code).toBe('TIMEOUT');
    expect(error.message).toBe('Atmospheric forecast did not answer within 5000 ms.');
  });

  it('retries a 5xx once and gives up after the second', async () => {
    const fetch = sequence(jsonResponse({}, 502), jsonResponse({}, 503), body());

    const error = await refreshError(
      new OpenMeteoMarineClient(jsonRequest(fetch, requestLogger), silentLogger()).fetchForecast(
        PENICHE,
      ),
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(error.code).toBe('UPSTREAM_FAILURE');
    expect(error.message).toBe('Marine forecast answered HTTP 503.');
  });

  it('does not retry a rate limit', async () => {
    const fetch = sequence(jsonResponse({}, 429), body());

    const error = await refreshError(
      new OpenMeteoAtmosphericClient(
        jsonRequest(fetch, requestLogger),
        silentLogger(),
      ).fetchForecast(PENICHE),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error.code).toBe('RATE_LIMITED');
  });

  it('does not retry a 4xx, and keeps the provider reason out of the message', async () => {
    const fetch = sequence(jsonResponse({ error: true, reason: 'Cannot initialize bogus' }, 400));

    const error = await refreshError(
      new OpenMeteoMarineClient(jsonRequest(fetch, requestLogger), silentLogger()).fetchForecast(
        PENICHE,
      ),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error.code).toBe('UPSTREAM_FAILURE');
    expect(error.message).not.toContain('bogus');
  });

  it('logs provider text cut short and without control characters', async () => {
    warn.mockClear();
    const fetch = sequence(
      new Response(`line one\nFORGED LOG LINE\u001b[31m${'x'.repeat(500)}`, { status: 404 }),
    );

    await refreshError(
      new OpenMeteoAtmosphericClient(
        jsonRequest(fetch, requestLogger),
        silentLogger(),
      ).fetchForecast(PENICHE),
    );

    const logged = String(warn.mock.calls.at(-1)?.[0]);
    expect(logged).toContain('line one FORGED LOG LINE');
    expect(/\p{Cc}/u.test(logged)).toBe(false);
    expect(logged.length).toBeLessThan(300);
  });

  it('rejects an oversized answer without retrying', async () => {
    const fetch = sequence(new Response(' '.repeat(MAX_RESPONSE_BYTES + 1), { status: 200 }));

    const error = await refreshError(
      new OpenMeteoMarineClient(jsonRequest(fetch, requestLogger), silentLogger()).fetchForecast(
        PENICHE,
      ),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.message).toBe(
      `Marine forecast answered with more than ${MAX_RESPONSE_BYTES} bytes.`,
    );
  });

  it('does not retry an invalid payload', async () => {
    const fetch = sequence(new Response('<html>', { status: 200 }), body());

    const error = await refreshError(
      new OpenMeteoAtmosphericClient(
        jsonRequest(fetch, requestLogger),
        silentLogger(),
      ).fetchForecast(PENICHE),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error.code).toBe('INVALID_PAYLOAD');
  });
});
