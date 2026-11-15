import type { ForecastWindow } from '../calendar/calendar.types';
import type { NormalizedForecast, WeatherSource } from '../forecast/forecast.types';

/**
 * Activity ranking types. Names and values follow the GraphQL `Activity`,
 * `DayAvailability`, `DayUnavailableCode`, `RankedDay` and `ActivityRanking`
 * types in the Technical Design, so ARC-48 maps them 1:1.
 */

/** The version of the scoring rules (ADR 0005); its value is `SCORING_VERSION`. */
export type ScoringVersion = 'v1';

export type Activity = 'SKIING' | 'SURFING' | 'OUTDOOR_SIGHTSEEING' | 'INDOOR_SIGHTSEEING';

export type DayAvailability = 'AVAILABLE' | 'UNAVAILABLE';

export type DayUnavailableCode =
  | 'ATMOSPHERIC_UNAVAILABLE'
  | 'MARINE_UNAVAILABLE'
  | 'MISSING_ATMOSPHERIC_INPUTS'
  | 'MISSING_MARINE_INPUTS'
  | 'INVALID_MARINE_GRID'
  | 'MARINE_GRID_TOO_DISTANT';

/**
 * One local date of one activity. An available day has an integer score from 0
 * to 100 and a rank; an unavailable day has neither and carries a typed code.
 * `reason` explains either outcome from the actual inputs.
 */
export type RankedDay =
  | {
      date: string;
      availability: 'AVAILABLE';
      score: number;
      rank: number;
      reason: string;
      unavailableCode: null;
    }
  | {
      date: string;
      availability: 'UNAVAILABLE';
      score: null;
      rank: null;
      reason: string;
      unavailableCode: DayUnavailableCode;
    };

export interface ActivityRanking {
  activity: Activity;
  /** One entry per requested date: ranked days first, then unavailable days by date. */
  days: RankedDay[];
}

export interface ActivityScores {
  scoringVersion: ScoringVersion;
  activities: ActivityRanking[];
}

/**
 * Normalized weather for one request: the seven frozen local dates and each
 * source's forecast, or null when the source is unavailable. A stale snapshot is
 * scored like a fresh one; freshness is reported separately in `SourceStatus`.
 */
export interface ScoringInput {
  window: ForecastWindow;
  atmospheric: NormalizedForecast | null;
  marine: NormalizedForecast | null;
}

/** Ascending input values with the component score at each; linear in between, clamped outside. */
export type Breakpoints = readonly (readonly [value: number, score: number])[];

/** One weighted factor of a score, named for explanations. */
export interface Component {
  label: string;
  weight: number;
  score: number;
}

export interface WeightedScore {
  /** Unrounded total from 0 to 100. */
  total: number;
  components: Component[];
}

export interface OutdoorInputs {
  meanTemperatureC: number;
  totalPrecipitationMm: number;
  maxWindKmh: number;
}

export interface SkiingInputs {
  meanSnowDepthM: number;
  meanTemperatureC: number;
  maxWindKmh: number;
}

export interface SurfingInputs {
  medianWaveHeightM: number;
  medianWavePeriodS: number;
  maxWindKmh: number;
}

/** Hourly variables scoring reads, by their normalized series names. */
export type WeatherField =
  | 'temperature_2m'
  | 'snow_depth'
  | 'precipitation'
  | 'wind_speed_10m'
  | 'wave_height'
  | 'wave_period';

export interface FieldRule {
  source: WeatherSource;
  hours: readonly number[];
  /** A negative value is physically impossible for the field and counts as missing. */
  nonNegative: boolean;
  /** Lower-case name used in explanations. */
  label: string;
}

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

export type MarineGridCheck =
  | { eligible: true; distanceKm: number }
  | { eligible: false; code: 'INVALID_MARINE_GRID' }
  | { eligible: false; code: 'MARINE_GRID_TOO_DISTANT'; distanceKm: number };
