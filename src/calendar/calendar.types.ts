/**
 * The seven local calendar dates a request ranks, frozen from the request instant
 * in the location's IANA time zone (ADR 0003).
 */
export interface ForecastWindow {
  timezone: string;
  /** ISO local dates (YYYY-MM-DD), ascending, starting tomorrow. */
  dates: string[];
}

/** A local wall-clock reading of an instant. */
export interface LocalDateTime {
  date: string;
  hour: number;
  minute: number;
  second: number;
}

export type Coverage = { complete: true } | { complete: false; missing: string[] };
