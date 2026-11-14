import type { ForecastWindow } from '../forecasts/forecast-window';
import type { NormalizedForecast, WeatherSource } from '../forecasts/weather-source';
import {
  ACTIVITIES,
  SCORING_VERSION,
  type Activity,
  type ActivityRanking,
  type ActivityScores,
  type DayUnavailableCode,
  type RankedDay,
} from './activity';
import {
  FIELD_RULES,
  max,
  mean,
  median,
  REQUIRED_SAMPLES,
  sampleSource,
  sum,
  type SourceSamples,
  type WeatherField,
} from './day-samples';
import { checkMarineGrid, MAX_MARINE_GRID_OFFSET_KM, type MarineGridCheck } from './marine-grid';
import {
  indoorScore,
  limitingComponent,
  outdoorScore,
  roundScore,
  skiingScore,
  surfingScore,
  type WeightedScore,
} from './scoring-v1';

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

/** The nine usable samples of each field an activity uses. */
type Values = (field: WeatherField) => number[];

interface Scored {
  score: number;
  reason: string;
}

interface ActivityRule {
  activity: Activity;
  /** Lower-case name used in explanations. */
  name: string;
  /** Fields the activity needs, atmospheric before marine. */
  fields: readonly WeatherField[];
  score(values: Values, grid: { distanceKm: number }): Scored;
}

type DayOutcome =
  | { date: string; available: true; score: number; reason: string }
  | { date: string; available: false; code: DayUnavailableCode; reason: string };

const SOURCE_ORDER: readonly WeatherSource[] = ['ATMOSPHERIC', 'MARINE'];

const RULES: Readonly<Record<Activity, ActivityRule>> = {
  SKIING: {
    activity: 'SKIING',
    name: 'skiing',
    fields: ['snow_depth', 'temperature_2m', 'wind_speed_10m'],
    score(values) {
      const inputs = {
        meanSnowDepthM: mean(values('snow_depth')),
        meanTemperatureC: mean(values('temperature_2m')),
        maxWindKmh: max(values('wind_speed_10m')),
      };
      const score = skiingScore(inputs);
      const measured = `mean snow depth ${metres(inputs.meanSnowDepthM)}, mean ${celsius(inputs.meanTemperatureC)} and wind up to ${kmh(inputs.maxWindKmh)} from 09:00 to 17:00`;
      const reason =
        inputs.meanSnowDepthM === 0
          ? `No snow on the ground: ${measured}.`
          : `${capitalize(measured)}; ${limitation(score)}.`;
      return { score: score.total, reason };
    },
  },
  SURFING: {
    activity: 'SURFING',
    name: 'surfing',
    fields: ['wind_speed_10m', 'wave_height', 'wave_period'],
    score(values, grid) {
      const inputs = {
        medianWaveHeightM: median(values('wave_height')),
        medianWavePeriodS: median(values('wave_period')),
        maxWindKmh: max(values('wind_speed_10m')),
      };
      const score = surfingScore(inputs);
      return {
        score: score.total,
        reason:
          `Median wave height ${metres(inputs.medianWaveHeightM)}, median period ${seconds(inputs.medianWavePeriodS)} ` +
          `and wind up to ${kmh(inputs.maxWindKmh)} from 09:00 to 17:00, at a model grid point ` +
          `${kilometres(grid.distanceKm)} away; ${limitation(score)}.`,
      };
    },
  },
  OUTDOOR_SIGHTSEEING: {
    activity: 'OUTDOOR_SIGHTSEEING',
    name: 'outdoor sightseeing',
    fields: ['temperature_2m', 'precipitation', 'wind_speed_10m'],
    score(values) {
      const { inputs, score } = outdoor(values);
      return {
        score: score.total,
        reason: `${capitalize(describeOutdoor(inputs))}; ${limitation(score)}.`,
      };
    },
  },
  INDOOR_SIGHTSEEING: {
    activity: 'INDOOR_SIGHTSEEING',
    name: 'indoor sightseeing',
    fields: ['temperature_2m', 'precipitation', 'wind_speed_10m'],
    score(values) {
      const { inputs, score } = outdoor(values);
      return {
        score: indoorScore(score.total),
        reason:
          `Outdoor sightseeing scores ${roundScore(score.total)} with ${describeOutdoor(inputs)}; ` +
          `an indoor alternative gains appeal as outdoor conditions worsen.`,
      };
    },
  },
};

/**
 * Scores and ranks the window's dates for each activity with scoring v1
 * (ADR 0004, ADR 0005). Pure: the same input always yields the same output.
 *
 * Each day checks, in order, that its sources are available, that every field it
 * uses has nine usable samples, and, for surfing, that the marine grid point is
 * valid and within 25 km. Within a check the atmospheric failure is reported
 * before the marine one. Every activity returns one entry per date.
 */
export function scoreActivities(input: ScoringInput): ActivityScores {
  const { window } = input;
  const samples: Record<WeatherSource, SourceSamples | null> = {
    ATMOSPHERIC: sampleSource('ATMOSPHERIC', input.atmospheric, window),
    MARINE: sampleSource('MARINE', input.marine, window),
  };
  const grid: MarineGridCheck | null =
    input.marine === null ? null : checkMarineGrid(input.marine.requested, input.marine.returned);

  const activities: ActivityRanking[] = ACTIVITIES.map((activity) => {
    const rule = RULES[activity];
    const outcomes = window.dates.map((date) => scoreDay(rule, date, samples, grid));
    return { activity, days: rankDays(outcomes) };
  });
  return { scoringVersion: SCORING_VERSION, activities };
}

function scoreDay(
  rule: ActivityRule,
  date: string,
  samples: Record<WeatherSource, SourceSamples | null>,
  grid: MarineGridCheck | null,
): DayOutcome {
  const unavailable = (code: DayUnavailableCode, why: string): DayOutcome => ({
    date,
    available: false,
    code,
    reason: `${why}, so ${rule.name} cannot be scored.`,
  });
  const sources = SOURCE_ORDER.filter((source) =>
    rule.fields.some((field) => FIELD_RULES[field].source === source),
  );

  const available: [WeatherSource, SourceSamples][] = [];
  for (const source of sources) {
    const sourceSamples = samples[source];
    if (sourceSamples === null) {
      return unavailable(
        source === 'ATMOSPHERIC' ? 'ATMOSPHERIC_UNAVAILABLE' : 'MARINE_UNAVAILABLE',
        `${source === 'ATMOSPHERIC' ? 'Atmospheric' : 'Marine'} forecast data is unavailable for the requested dates`,
      );
    }
    available.push([source, sourceSamples]);
  }

  const values = new Map<WeatherField, number[]>();
  for (const [source, sourceSamples] of available) {
    const missing: string[] = [];
    for (const field of rule.fields.filter((name) => FIELD_RULES[name].source === source)) {
      const fieldSamples = sourceSamples.field(field, date);
      if (fieldSamples.usable) {
        values.set(field, fieldSamples.values);
      } else {
        missing.push(`${FIELD_RULES[field].label} (${hourList(fieldSamples.missingHours)})`);
      }
    }
    if (missing.length > 0) {
      return unavailable(
        source === 'ATMOSPHERIC' ? 'MISSING_ATMOSPHERIC_INPUTS' : 'MISSING_MARINE_INPUTS',
        `Missing usable ${joinList(missing)}`,
      );
    }
  }

  let distanceKm = Number.NaN;
  if (sources.includes('MARINE')) {
    if (grid === null || !grid.eligible) {
      return grid?.code === 'MARINE_GRID_TOO_DISTANT'
        ? unavailable(
            'MARINE_GRID_TOO_DISTANT',
            `The marine model grid point is ${tooFar(grid.distanceKm)}, beyond the ${MAX_MARINE_GRID_OFFSET_KM} km limit`,
          )
        : unavailable('INVALID_MARINE_GRID', 'The marine model grid coordinates are invalid');
    }
    distanceKm = grid.distanceKm;
  }

  const valuesOf: Values = (field) => {
    const fieldValues = values.get(field);
    if (fieldValues === undefined) {
      throw new Error(`${rule.activity} reads ${field}, which it does not declare.`);
    }
    return fieldValues;
  };
  const scored = rule.score(valuesOf, { distanceKm });
  return { date, available: true, score: scored.score, reason: scored.reason };
}

/**
 * Orders scored days by rounded score descending, then date ascending, with
 * sequential ranks from 1; unavailable days follow in date order.
 */
function rankDays(outcomes: DayOutcome[]): RankedDay[] {
  const byDate = (a: { date: string }, b: { date: string }) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  const scored = outcomes
    .filter((outcome) => outcome.available)
    .map((outcome) => ({ ...outcome, rounded: roundScore(outcome.score) }))
    .sort((a, b) => b.rounded - a.rounded || byDate(a, b));
  const unavailable = outcomes.filter((outcome) => !outcome.available).sort(byDate);

  return [
    ...scored.map((day, index): RankedDay => ({
      date: day.date,
      availability: 'AVAILABLE',
      score: day.rounded,
      rank: index + 1,
      reason: day.reason,
      unavailableCode: null,
    })),
    ...unavailable.map((day): RankedDay => ({
      date: day.date,
      availability: 'UNAVAILABLE',
      score: null,
      rank: null,
      reason: day.reason,
      unavailableCode: day.code,
    })),
  ];
}

function outdoor(values: Values) {
  const inputs = {
    meanTemperatureC: mean(values('temperature_2m')),
    totalPrecipitationMm: sum(values('precipitation')),
    maxWindKmh: max(values('wind_speed_10m')),
  };
  return { inputs, score: outdoorScore(inputs) };
}

function describeOutdoor(inputs: ReturnType<typeof outdoor>['inputs']): string {
  return (
    `mean ${celsius(inputs.meanTemperatureC)}, ${millimetres(inputs.totalPrecipitationMm)} of ` +
    `precipitation and wind up to ${kmh(inputs.maxWindKmh)} from 09:00 to 18:00`
  );
}

function limitation(score: WeightedScore): string {
  const worst = limitingComponent(score);
  return worst === undefined ? 'every factor is ideal' : `${worst.label} lowers the score most`;
}

function hourList(hours: readonly number[]): string {
  return hours.length === REQUIRED_SAMPLES
    ? `all ${REQUIRED_SAMPLES} hours`
    : hours.map((hour) => `${String(hour).padStart(2, '0')}:00`).join(', ');
}

function joinList(items: readonly string[]): string {
  return items.length <= 1
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** A distance over the cap, never printed as a figure that reads as within it. */
function tooFar(distanceKm: number): string {
  const shown = fixed(distanceKm, 1);
  return Number(shown) > MAX_MARINE_GRID_OFFSET_KM
    ? `${shown} km away`
    : `more than ${MAX_MARINE_GRID_OFFSET_KM} km away`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const celsius = (value: number) => `${fixed(value, 1)} °C`;
const metres = (value: number) => `${fixed(value, 2)} m`;
const millimetres = (value: number) => `${fixed(value, 1)} mm`;
const kmh = (value: number) => `${fixed(value, 1)} km/h`;
const seconds = (value: number) => `${fixed(value, 1)} s`;
const kilometres = (value: number) => `${fixed(value, 1)} km`;

/** Fixed decimals without a negative zero such as "-0.0". */
function fixed(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return Number(text) === 0 ? (0).toFixed(decimals) : text;
}
