import {
  OUTDOOR_PRECIPITATION_MM,
  OUTDOOR_TEMPERATURE_C,
  OUTDOOR_WIND_KMH,
  SKI_SNOW_DEPTH_M,
  SKI_TEMPERATURE_C,
  SKI_WIND_KMH,
  SURF_WAVE_HEIGHT_M,
  SURF_WAVE_PERIOD_S,
  SURF_WIND_KMH,
} from './activity-scoring.constants';
import type {
  Breakpoints,
  Component,
  OutdoorInputs,
  SkiingInputs,
  SurfingInputs,
  WeightedScore,
} from './activity.types';

/**
 * Scoring v1 formulas (ADR 0005, Technical Design "Scoring v1"). Illustrative
 * weather-suitability heuristics for a generic recreational visitor, in °C, m,
 * mm, km/h and s. Every function is pure and returns unrounded scores from 0 to 100.
 */

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
