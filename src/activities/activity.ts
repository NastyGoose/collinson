/**
 * Activity ranking types. Names and values follow the GraphQL `Activity`,
 * `DayAvailability`, `DayUnavailableCode`, `RankedDay` and `ActivityRanking`
 * types in the Technical Design, so ARC-48 maps them 1:1.
 */

/** The scoring rules in this module (ADR 0005). Bump with any formula or edge-case change. */
export const SCORING_VERSION = 'v1';

export type Activity = 'SKIING' | 'SURFING' | 'OUTDOOR_SIGHTSEEING' | 'INDOOR_SIGHTSEEING';

/** Activity groups in the order of the GraphQL `Activity` enum. */
export const ACTIVITIES: readonly Activity[] = [
  'SKIING',
  'SURFING',
  'OUTDOOR_SIGHTSEEING',
  'INDOOR_SIGHTSEEING',
];

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
  scoringVersion: typeof SCORING_VERSION;
  activities: ActivityRanking[];
}
