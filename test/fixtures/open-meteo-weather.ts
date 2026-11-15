/**
 * Controlled Open-Meteo forecast and marine payloads, shaped like the live
 * responses probed on 2026-11-14 (Peniche atmospheric, Warsaw marine): metadata,
 * declared units and 192 hourly rows from local midnight, as Unix seconds.
 */
import type { Location } from '../../src/location/location.types';

const HOUR_S = 60 * 60;

/** Europe/Lisbon is UTC+0 in November, so local and UTC hours coincide. */
export const PENICHE: Location = {
  id: '2264508',
  name: 'Peniche',
  country: 'Portugal',
  region: 'Leiria',
  latitude: 39.3558,
  longitude: -9.38112,
  timezone: 'Europe/Lisbon',
};

/** Europe/Warsaw is UTC+1 in November: local midnight is 23:00 UTC the day before. */
export const WARSAW: Location = {
  id: '756135',
  name: 'Warsaw',
  country: 'Poland',
  region: 'Masovia',
  latitude: 52.22977,
  longitude: 21.01178,
  timezone: 'Europe/Warsaw',
};

/** A provider payload as the fixtures build it: every field untrusted, except the shape tests edit. */
export interface Payload {
  [key: string]: unknown;
  hourly: Record<string, unknown[]>;
  hourly_units: Record<string, unknown>;
}

export interface HourlyOptions {
  /** UTC instant of the first row, normally local midnight of the provider's "today". */
  firstHour: string;
  /** Number of hourly rows; 192 is eight days. */
  hours?: number;
  /** Returned grid point; defaults to a point near the requested one. */
  latitude?: number;
  longitude?: number;
  /** Echoed time zone and offset; the adapter ignores both and buckets by the location's zone. */
  timezone?: string;
  utcOffsetSeconds?: number;
}

export function hourlyTimes(firstHour: string, hours = 8 * 24): number[] {
  const first = Date.parse(firstHour) / 1000;
  return Array.from({ length: hours }, (_, index) => first + index * HOUR_S);
}

/**
 * A complete atmospheric payload: mild, dry and breezy, with a null temperature at
 * 03:00 local each day (outside the ranked hours) as the provider sometimes sends.
 */
export function atmosphericBody(options: HourlyOptions): Payload {
  const time = hourlyTimes(options.firstHour, options.hours);
  return {
    latitude: options.latitude ?? 39.371773,
    longitude: options.longitude ?? -9.33009,
    generationtime_ms: 0.17,
    utc_offset_seconds: options.utcOffsetSeconds ?? 0,
    timezone: options.timezone ?? 'Europe/Lisbon',
    elevation: 17,
    hourly_units: {
      time: 'unixtime',
      temperature_2m: '°C',
      snow_depth: 'm',
      precipitation: 'mm',
      wind_speed_10m: 'km/h',
    },
    hourly: {
      time,
      temperature_2m: time.map((_, index) => (index % 24 === 3 ? null : 12 + (index % 24) / 4)),
      snow_depth: time.map(() => 0),
      precipitation: time.map((_, index) => (index % 24 === 15 ? 0.4 : 0)),
      wind_speed_10m: time.map(() => 14.5),
    },
  };
}

/** A marine payload with complete waves, or entirely null waves as inland points return. */
export function marineBody(options: HourlyOptions & { waves?: 'complete' | 'null' }): Payload {
  const time = hourlyTimes(options.firstHour, options.hours);
  const allNull = options.waves === 'null';
  return {
    latitude: options.latitude ?? 39.375,
    longitude: options.longitude ?? -9.374985,
    generationtime_ms: 0.12,
    utc_offset_seconds: options.utcOffsetSeconds ?? 0,
    timezone: options.timezone ?? 'Europe/Lisbon',
    elevation: 17,
    hourly_units: { time: 'unixtime', wave_height: 'm', wave_period: 's' },
    hourly: {
      time,
      wave_height: time.map(() => (allNull ? null : 1.4)),
      wave_period: time.map(() => (allNull ? null : 11.2)),
    },
  };
}

/** Deep-copies a payload so a test can corrupt one field without touching the original. */
export function clonePayload(body: Payload): Payload {
  return structuredClone(body);
}

/** Warsaw's offset in November, for payloads that echo it. */
export const WARSAW_OFFSET = { timezone: 'Europe/Warsaw', utcOffsetSeconds: 3600 } as const;
