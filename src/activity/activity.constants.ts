import type { Activity, FieldRule, ScoringVersion, WeatherField } from './activity.types';

/** The scoring rules in this folder (ADR 0005). Bump with any formula or edge-case change. */
export const SCORING_VERSION: ScoringVersion = 'v1';

/** Activity groups in the order of the GraphQL `Activity` enum. */
export const ACTIVITIES: readonly Activity[] = [
  'SKIING',
  'SURFING',
  'OUTDOOR_SIGHTSEEING',
  'INDOOR_SIGHTSEEING',
];

/** Instantaneous fields are read at 09:00 through 17:00 local time (ADR 0005). */
export const INSTANT_HOURS: readonly number[] = [9, 10, 11, 12, 13, 14, 15, 16, 17];

/**
 * Open-Meteo precipitation covers the preceding hour, so 10:00 through 18:00
 * local time sums the 09:00–18:00 activity window (ADR 0005).
 */
export const PRECIPITATION_HOURS: readonly number[] = [10, 11, 12, 13, 14, 15, 16, 17, 18];

/** Every field an activity uses needs this many usable values per date. */
export const REQUIRED_SAMPLES = 9;

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

/** Mean Earth radius used for the grid offset (ADR 0004). */
export const EARTH_RADIUS_KM = 6371.0088;

/** Largest accepted distance between the requested point and the marine grid cell, inclusive. */
export const MAX_MARINE_GRID_OFFSET_KM = 25;
