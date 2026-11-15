import type { Breakpoints } from './activity.types';

/**
 * Scoring v1 breakpoint tables (ADR 0005, Technical Design "Scoring v1"):
 * illustrative weather-suitability heuristics for a generic recreational
 * visitor, in °C, m, mm, km/h and s.
 */

export const OUTDOOR_TEMPERATURE_C: Breakpoints = [
  [0, 0],
  [20, 100],
  [35, 0],
];
export const OUTDOOR_PRECIPITATION_MM: Breakpoints = [
  [0, 100],
  [8, 0],
];
export const OUTDOOR_WIND_KMH: Breakpoints = [
  [10, 100],
  [40, 0],
];

export const SKI_SNOW_DEPTH_M: Breakpoints = [
  [0, 0],
  [0.3, 100],
];
export const SKI_TEMPERATURE_C: Breakpoints = [
  [-20, 0],
  [-5, 100],
  [5, 0],
];
export const SKI_WIND_KMH: Breakpoints = [
  [10, 100],
  [45, 0],
];

export const SURF_WAVE_HEIGHT_M: Breakpoints = [
  [0, 0],
  [1.2, 100],
  [3, 0],
];
export const SURF_WAVE_PERIOD_S: Breakpoints = [
  [4, 0],
  [12, 100],
];
export const SURF_WIND_KMH: Breakpoints = [
  [10, 100],
  [40, 0],
];
