import type { ForecastSourceSpec } from './forecast.types';

/** A coverage-complete snapshot younger than this is reused without a refresh (SPEC-02). */
export const FRESH_FOR_MS = 6 * 60 * 60 * 1000;
/** After a failed refresh, a coverage-complete snapshot up to this old is served as stale. */
export const STALE_FALLBACK_MS = 24 * 60 * 60 * 1000;

/** Per-attempt limit (SPEC-02). */
export const OPEN_METEO_TIMEOUT_MS = 5_000;

/** Today plus the seven ranked dates, so a request near local midnight still has tomorrow. */
export const FORECAST_DAYS_REQUESTED = 8;

/**
 * Hourly temperature, snow depth, precipitation and 10 m wind in metric units.
 * Instantaneous fields are sampled at 09:00–17:00 and precipitation, which covers
 * the preceding hour, at 10:00–18:00 local time (Technical Design, scoring v1).
 * https://open-meteo.com/en/docs
 */
export const ATMOSPHERIC_SPEC: ForecastSourceSpec = {
  source: 'ATMOSPHERIC',
  schemaVersion: 1,
  label: 'Atmospheric forecast',
  endpoint: 'https://api.open-meteo.com/v1/forecast',
  variables: {
    temperature_2m: '°C',
    snow_depth: 'm',
    precipitation: 'mm',
    wind_speed_10m: 'km/h',
  },
  params: {
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  },
  requiredLocalHours: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
};

/**
 * Hourly wave height and period from the nearest sea grid cell, sampled at
 * 09:00–17:00 local time. Inland points answer with complete timestamps and
 * entirely null waves; such a payload is valid and stored (ADR 0004).
 * https://open-meteo.com/en/docs/marine-weather-api
 */
export const MARINE_SPEC: ForecastSourceSpec = {
  source: 'MARINE',
  schemaVersion: 1,
  label: 'Marine forecast',
  endpoint: 'https://marine-api.open-meteo.com/v1/marine',
  variables: {
    wave_height: 'm',
    wave_period: 's',
  },
  params: {
    cell_selection: 'sea',
    length_unit: 'metric',
  },
  requiredLocalHours: [9, 10, 11, 12, 13, 14, 15, 16, 17],
};
