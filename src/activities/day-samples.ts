import { checkCoverage, toLocalDateTime } from '../calendar/calendar.logic';
import type { ForecastWindow } from '../calendar/calendar.types';
import type { NormalizedForecast, WeatherSource } from '../forecasts/weather-source';

/** Instantaneous fields are read at 09:00 through 17:00 local time (ADR 0005). */
export const INSTANT_HOURS: readonly number[] = [9, 10, 11, 12, 13, 14, 15, 16, 17];

/**
 * Open-Meteo precipitation covers the preceding hour, so 10:00 through 18:00
 * local time sums the 09:00–18:00 activity window (ADR 0005).
 */
export const PRECIPITATION_HOURS: readonly number[] = [10, 11, 12, 13, 14, 15, 16, 17, 18];

/** Every field an activity uses needs this many usable values per date. */
export const REQUIRED_SAMPLES = 9;

/** Hourly variables scoring reads, by their normalized series names. */
export type WeatherField =
  | 'temperature_2m'
  | 'snow_depth'
  | 'precipitation'
  | 'wind_speed_10m'
  | 'wave_height'
  | 'wave_period';

interface FieldRule {
  source: WeatherSource;
  hours: readonly number[];
  /** A negative value is physically impossible for the field and counts as missing. */
  nonNegative: boolean;
  /** Lower-case name used in explanations. */
  label: string;
}

export const FIELD_RULES: Readonly<Record<WeatherField, FieldRule>> = {
  temperature_2m: {
    source: 'ATMOSPHERIC',
    hours: INSTANT_HOURS,
    nonNegative: false,
    label: 'temperature',
  },
  snow_depth: {
    source: 'ATMOSPHERIC',
    hours: INSTANT_HOURS,
    nonNegative: true,
    label: 'snow depth',
  },
  precipitation: {
    source: 'ATMOSPHERIC',
    hours: PRECIPITATION_HOURS,
    nonNegative: true,
    label: 'precipitation',
  },
  wind_speed_10m: { source: 'ATMOSPHERIC', hours: INSTANT_HOURS, nonNegative: true, label: 'wind' },
  wave_height: { source: 'MARINE', hours: INSTANT_HOURS, nonNegative: true, label: 'wave height' },
  wave_period: { source: 'MARINE', hours: INSTANT_HOURS, nonNegative: true, label: 'wave period' },
};

/** The parts of a normalized forecast scoring reads. */
export type ScoringForecast = Pick<NormalizedForecast, 'source' | 'timezone' | 'hourly'>;

/** A field's values on one date: all nine usable, or the local hours that lack one. */
export type FieldSamples =
  { usable: true; values: number[] } | { usable: false; missingHours: number[] };

/** One source's hourly values, indexed by local date and hour for the window. */
export interface SourceSamples {
  /** The values of `field` on `date`, a date of the window, at the field's scoring hours. */
  field(field: WeatherField, date: string): FieldSamples;
}

/**
 * Indexes a source's forecast for scoring. Returns null when the source is
 * unavailable or lacks exactly one instant at each local hour scoring reads on
 * every date of the window: the source then fails the coverage check (ADR 0005).
 * Throws when the forecast belongs to another source or time zone, a caller bug.
 */
export function sampleSource(
  source: WeatherSource,
  forecast: ScoringForecast | null,
  window: ForecastWindow,
): SourceSamples | null {
  if (forecast === null) {
    return null;
  }
  if (forecast.source !== source) {
    throw new Error(`Expected a ${source} forecast, got ${forecast.source}.`);
  }
  if (forecast.timezone !== window.timezone) {
    throw new Error(
      `The ${source} forecast is in ${forecast.timezone}, but the window is in ${window.timezone}.`,
    );
  }

  const hours = scoringHours(source);
  if (!checkCoverage(forecast.hourly.time, window, hours).complete) {
    return null;
  }

  // Coverage guarantees exactly one instant per required local hour.
  const indexByHour = new Map<string, number>();
  forecast.hourly.time.forEach((seconds, index) => {
    const local = toLocalDateTime(seconds * 1000, window.timezone);
    if (local.minute === 0 && local.second === 0) {
      indexByHour.set(hourKey(local.date, local.hour), index);
    }
  });

  return {
    field(field, date) {
      const rule = FIELD_RULES[field];
      if (rule.source !== source) {
        throw new Error(`${field} is not a ${source} field.`);
      }
      const series = forecast.hourly.series[field] ?? [];
      const values: number[] = [];
      const missingHours: number[] = [];
      for (const hour of rule.hours) {
        const index = indexByHour.get(hourKey(date, hour));
        if (index === undefined) {
          throw new Error(`${date} is not a date of the scoring window.`);
        }
        const value = series[index];
        if (isUsable(value, rule)) {
          values.push(value);
        } else {
          missingHours.push(hour);
        }
      }
      return missingHours.length === 0 ? { usable: true, values } : { usable: false, missingHours };
    },
  };
}

/** The local hours scoring reads from a source: the union of its fields' hours, ascending. */
export function scoringHours(source: WeatherSource): number[] {
  const hours = new Set<number>();
  for (const rule of Object.values(FIELD_RULES)) {
    if (rule.source === source) {
      rule.hours.forEach((hour) => hours.add(hour));
    }
  }
  return [...hours].sort((a, b) => a - b);
}

function isUsable(value: number | null | undefined, rule: FieldRule): value is number {
  return typeof value === 'number' && Number.isFinite(value) && (!rule.nonNegative || value >= 0);
}

function hourKey(date: string, hour: number): string {
  return `${date}T${hour}`;
}

export function mean(values: readonly number[]): number {
  return sum(values) / values.length;
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function max(values: readonly number[]): number {
  return Math.max(...values);
}

/** The middle value; with an even count, the mean of the two middle values. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
