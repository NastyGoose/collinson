/**
 * Normalized weather for scoring tests, built per local date and hour so a test
 * states exactly which sample it changes. Defaults are the dry 20 °C, 25 km/h day
 * of the Technical Design example, with 1.2 m waves at 12 s on the marine side.
 */
import type { WeatherField } from '../../src/activities/day-samples';
import { addDays, toLocalDateTime } from '../../src/calendar/calendar.logic';
import type { ForecastWindow } from '../../src/calendar/calendar.types';
import type {
  Coordinates,
  NormalizedForecast,
  WeatherSource,
} from '../../src/forecasts/weather-source';

const HOUR_S = 60 * 60;

/** A value for a field at a local date and hour; null is a provider null. */
export type FieldValues = (date: string, hour: number) => number | null;

export type WeatherOverrides = Partial<Record<WeatherField, number | null | FieldValues>>;

export const DEFAULT_VALUES: Readonly<Record<WeatherField, number>> = {
  temperature_2m: 20,
  snow_depth: 0,
  precipitation: 0,
  wind_speed_10m: 25,
  wave_height: 1.2,
  wave_period: 12,
};

/** Requested point near Peniche and a sea grid cell about 3.8 km away. */
export const REQUESTED: Coordinates = { latitude: 39.3558, longitude: -9.38112 };
export const NEAR_GRID: Coordinates = { latitude: 39.375, longitude: -9.344985 };

export const ORIGIN: Coordinates = { latitude: 0, longitude: 0 };
/** Due north of the origin at exactly 25 km on the 6371.0088 km sphere, in IEEE doubles. */
export const AT_25_KM: Coordinates = { latitude: 0.2248300909311345, longitude: 0 };
/** The next representable step further north: a hair over 25 km. */
export const JUST_OVER_25_KM: Coordinates = { latitude: 0.2248300909311355, longitude: 0 };

const FIELDS_BY_SOURCE: Record<WeatherSource, WeatherField[]> = {
  ATMOSPHERIC: ['temperature_2m', 'snow_depth', 'precipitation', 'wind_speed_10m'],
  MARINE: ['wave_height', 'wave_period'],
};

const UNITS: Record<WeatherField, string> = {
  temperature_2m: '°C',
  snow_depth: 'm',
  precipitation: 'mm',
  wind_speed_10m: 'km/h',
  wave_height: 'm',
  wave_period: 's',
};

export function atmosphericForecast(
  window: ForecastWindow,
  overrides: WeatherOverrides = {},
): NormalizedForecast {
  return forecast('ATMOSPHERIC', window, overrides, REQUESTED);
}

export function marineForecast(
  window: ForecastWindow,
  overrides: WeatherOverrides = {},
  returned: Coordinates = NEAR_GRID,
): NormalizedForecast {
  return forecast('MARINE', window, overrides, returned);
}

/** A value function that returns `value` on `date` (every hour) and the default elsewhere. */
export function onDate(date: string, value: number | null, otherwise: number): FieldValues {
  return (localDate) => (localDate === date ? value : otherwise);
}

/** Drops the hourly row at `epochSeconds` from the timeline and every series, in place. */
export function withoutInstant(forecast: NormalizedForecast, epochSeconds: number): void {
  const index = forecast.hourly.time.indexOf(epochSeconds);
  if (index === -1) {
    throw new Error(`No hourly row at ${epochSeconds}.`);
  }
  forecast.hourly.time.splice(index, 1);
  for (const values of Object.values(forecast.hourly.series)) {
    values.splice(index, 1);
  }
}

/**
 * Hourly rows on whole local hours from well before local midnight of the
 * provider's "today" to well after the last window date. Rows are shifted by the
 * zone's minute offset, so a +05:30 zone gets rows at local hh:00 as Open-Meteo
 * returns them.
 */
function forecast(
  source: WeatherSource,
  window: ForecastWindow,
  overrides: WeatherOverrides,
  returned: Coordinates,
): NormalizedForecast {
  const today = addDays(window.dates[0], -1);
  const start = Date.parse(`${today}T00:00:00Z`) / 1000 - 14 * HOUR_S;
  const first = start - toLocalDateTime(start * 1000, window.timezone).minute * 60;
  const time = Array.from({ length: 8 * 24 + 28 }, (_, index) => first + index * HOUR_S);
  const local = time.map((seconds) => toLocalDateTime(seconds * 1000, window.timezone));

  const fields = FIELDS_BY_SOURCE[source];
  const series: Record<string, (number | null)[]> = {};
  for (const field of fields) {
    const override = overrides[field];
    const valueAt: FieldValues =
      typeof override === 'function' ? override : () => override ?? DEFAULT_VALUES[field];
    if (override === null) {
      series[field] = time.map(() => null);
    } else {
      series[field] = local.map(({ date, hour }) => valueAt(date, hour));
    }
  }

  return {
    source,
    schemaVersion: 1,
    requested: REQUESTED,
    returned,
    timezone: window.timezone,
    units: Object.fromEntries(fields.map((field) => [field, UNITS[field]])),
    hourly: { time, series },
    coverageStart: new Date(time[0] * 1000),
    coverageEnd: new Date(time[time.length - 1] * 1000),
  };
}
