/**
 * Scoring v1 formulas (ADR 0005, Technical Design "Scoring v1"). Illustrative
 * weather-suitability heuristics for a generic recreational visitor, in °C, m,
 * mm, km/h and s. Every function is pure and returns unrounded scores from 0 to 100.
 */

/** Ascending input values with the component score at each; linear in between, clamped outside. */
export type Breakpoints = readonly (readonly [value: number, score: number])[];

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

export function interpolate(value: number, breakpoints: Breakpoints): number {
  const [firstValue, firstScore] = breakpoints[0];
  if (value <= firstValue) {
    return firstScore;
  }
  for (let index = 1; index < breakpoints.length; index += 1) {
    const [upperValue, upperScore] = breakpoints[index];
    if (value <= upperValue) {
      const [lowerValue, lowerScore] = breakpoints[index - 1];
      const fraction = (value - lowerValue) / (upperValue - lowerValue);
      return lowerScore + (upperScore - lowerScore) * fraction;
    }
  }
  return breakpoints[breakpoints.length - 1][1];
}

/** 50% temperature, 30% precipitation, 20% wind. */
export function outdoorScore(inputs: OutdoorInputs): WeightedScore {
  return weighted([
    component('temperature', 0.5, interpolate(inputs.meanTemperatureC, OUTDOOR_TEMPERATURE_C)),
    component(
      'precipitation',
      0.3,
      interpolate(inputs.totalPrecipitationMm, OUTDOOR_PRECIPITATION_MM),
    ),
    component('wind', 0.2, interpolate(inputs.maxWindKmh, OUTDOOR_WIND_KMH)),
  ]);
}

/** The appeal of an indoor alternative: 50 + half of what the unrounded outdoor score lacks. */
export function indoorScore(unroundedOutdoor: number): number {
  return 50 + 0.5 * (100 - unroundedOutdoor);
}

/**
 * 50% snow depth, 30% temperature, 20% wind. A measured mean snow depth of 0 m
 * scores 0 whatever the other factors: there is nothing to ski on.
 */
export function skiingScore(inputs: SkiingInputs): WeightedScore {
  const score = weighted([
    component('snow depth', 0.5, interpolate(inputs.meanSnowDepthM, SKI_SNOW_DEPTH_M)),
    component('temperature', 0.3, interpolate(inputs.meanTemperatureC, SKI_TEMPERATURE_C)),
    component('wind', 0.2, interpolate(inputs.maxWindKmh, SKI_WIND_KMH)),
  ]);
  return inputs.meanSnowDepthM === 0 ? { ...score, total: 0 } : score;
}

/** 50% wave height, 30% wave period, 20% atmospheric wind. */
export function surfingScore(inputs: SurfingInputs): WeightedScore {
  return weighted([
    component('wave height', 0.5, interpolate(inputs.medianWaveHeightM, SURF_WAVE_HEIGHT_M)),
    component('wave period', 0.3, interpolate(inputs.medianWavePeriodS, SURF_WAVE_PERIOD_S)),
    component('wind', 0.2, interpolate(inputs.maxWindKmh, SURF_WIND_KMH)),
  ]);
}

/**
 * The final integer score, with halves rounded up. Floating-point noise is
 * trimmed first so a computed 89.49999999999999 rounds as the 89.5 it stands for.
 */
export function roundScore(unrounded: number): number {
  return Math.floor(Number(unrounded.toFixed(9)) + 0.5);
}

/** The factor that costs the most weighted points; the first on a tie, none when nothing is lost. */
export function limitingComponent(score: WeightedScore): Component | undefined {
  let worst: Component | undefined;
  let worstLoss = 0;
  for (const candidate of score.components) {
    const loss = candidate.weight * (100 - candidate.score);
    if (loss > worstLoss + 1e-9) {
      worst = candidate;
      worstLoss = loss;
    }
  }
  return worst;
}

function component(label: string, weight: number, score: number): Component {
  return { label, weight, score };
}

function weighted(components: Component[]): WeightedScore {
  return {
    total: components.reduce((total, part) => total + part.weight * part.score, 0),
    components,
  };
}
