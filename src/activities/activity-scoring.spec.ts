import {
  atmosphericForecast,
  marineForecast,
  onDate,
  type WeatherOverrides,
} from '../../test/fixtures/scoring-weather';
import { forecastWindow } from '../forecasts/forecast-window';
import type { NormalizedForecast } from '../forecasts/weather-source';
import type { Activity, ActivityScores, RankedDay } from './activity';
import { scoreActivities } from './activity-scoring';

const WINDOW = forecastWindow(new Date('2026-11-14T12:00:00Z'), 'Europe/Lisbon');
const [D1, D2, D3, D4, D5, D6, D7] = WINDOW.dates;

const ORIGIN = { latitude: 0, longitude: 0 };
/** Exactly 25 km due north of the origin on the mean-radius sphere (see marine-grid.spec). */
const AT_25_KM = { latitude: 0.2248300909311345, longitude: 0 };
const JUST_OVER_25_KM = { latitude: 0.2248300909311355, longitude: 0 };

function score(
  atmospheric: WeatherOverrides | null = {},
  marine: WeatherOverrides | null = {},
  grid?: Pick<NormalizedForecast, 'requested' | 'returned'>,
): ActivityScores {
  const marineData = marine === null ? null : { ...marineForecast(WINDOW, marine), ...grid };
  return scoreActivities({
    window: WINDOW,
    atmospheric: atmospheric === null ? null : atmosphericForecast(WINDOW, atmospheric),
    marine: marineData,
  });
}

function days(scores: ActivityScores, activity: Activity): RankedDay[] {
  const ranking = scores.activities.find((group) => group.activity === activity);
  if (ranking === undefined) {
    throw new Error(`No ${activity} group.`);
  }
  return ranking.days;
}

function day(scores: ActivityScores, activity: Activity, date: string): RankedDay {
  const found = days(scores, activity).find((entry) => entry.date === date);
  if (found === undefined) {
    throw new Error(`No ${activity} entry for ${date}.`);
  }
  return found;
}

/** Dates in ranked order with their scores, for compact ordering assertions. */
function order(scores: ActivityScores, activity: Activity): [string, number | null][] {
  return days(scores, activity).map((entry) => [entry.date, entry.score]);
}

describe('scoreActivities', () => {
  it('returns four groups of the seven requested dates under scoring v1', () => {
    const scores = score();
    expect(scores.scoringVersion).toBe('v1');
    expect(scores.activities.map((group) => group.activity)).toEqual([
      'SKIING',
      'SURFING',
      'OUTDOOR_SIGHTSEEING',
      'INDOOR_SIGHTSEEING',
    ]);
    for (const group of scores.activities) {
      expect(group.days.map((entry) => entry.date).sort()).toEqual(WINDOW.dates);
    }
  });

  it('scores the dry 20 °C, 25 km/h day as 90 outdoors and 55 indoors, citing the inputs', () => {
    const scores = score();
    expect(day(scores, 'OUTDOOR_SIGHTSEEING', D1)).toEqual({
      date: D1,
      availability: 'AVAILABLE',
      score: 90,
      rank: 1,
      reason:
        'Mean 20.0 °C, 0.0 mm of precipitation and wind up to 25.0 km/h from 09:00 to 18:00; ' +
        'wind lowers the score most.',
      unavailableCode: null,
    });
    expect(day(scores, 'INDOOR_SIGHTSEEING', D1)).toEqual({
      date: D1,
      availability: 'AVAILABLE',
      score: 55,
      rank: 1,
      reason:
        'Outdoor sightseeing scores 90 with mean 20.0 °C, 0.0 mm of precipitation and wind up to ' +
        '25.0 km/h from 09:00 to 18:00; an indoor alternative gains appeal as outdoor conditions worsen.',
      unavailableCode: null,
    });
  });

  it('is deterministic for identical input', () => {
    const atmospheric = { temperature_2m: (date: string, hour: number) => hour + date.length };
    expect(score(atmospheric)).toEqual(score(atmospheric));
  });

  describe('precipitation end-hour indexing', () => {
    it('counts precipitation stamped 18:00, which fell from 17:00 to 18:00', () => {
      const scores = score({
        precipitation: (date, hour) => (date === D3 && hour === 18 ? 8 : 0),
      });
      expect(day(scores, 'OUTDOOR_SIGHTSEEING', D3)).toMatchObject({ score: 60 });
      expect(day(scores, 'OUTDOOR_SIGHTSEEING', D3).reason).toContain('8.0 mm of precipitation');
      expect(day(scores, 'INDOOR_SIGHTSEEING', D3)).toMatchObject({ score: 70 });
    });

    it('ignores precipitation stamped 09:00, which fell before the window', () => {
      const scores = score({
        precipitation: (date, hour) => (date === D3 && hour === 9 ? 8 : 0),
      });
      expect(day(scores, 'OUTDOOR_SIGHTSEEING', D3)).toMatchObject({ score: 90 });
      expect(day(scores, 'OUTDOOR_SIGHTSEEING', D3).reason).toContain('0.0 mm of precipitation');
    });

    it('sums the nine hourly totals', () => {
      const scores = score({ precipitation: (date) => (date === D2 ? 0.5 : 0) });
      // 9 × 0.5 mm = 4.5 mm → precipitation component 43.75.
      expect(day(scores, 'OUTDOOR_SIGHTSEEING', D2).reason).toContain('4.5 mm of precipitation');
      expect(day(scores, 'OUTDOOR_SIGHTSEEING', D2)).toMatchObject({ score: 73 });
    });
  });

  describe('skiing snow', () => {
    it('scores a measured zero snow depth as an available 0', () => {
      const scores = score({ snow_depth: 0, temperature_2m: -5, wind_speed_10m: 10 });
      expect(day(scores, 'SKIING', D1)).toMatchObject({
        availability: 'AVAILABLE',
        score: 0,
        unavailableCode: null,
        reason:
          'No snow on the ground: mean snow depth 0.00 m, mean -5.0 °C and wind up to 10.0 km/h ' +
          'from 09:00 to 17:00.',
      });
    });

    it('makes absent snow data unavailable for skiing only', () => {
      const scores = score({ snow_depth: onDate(D4, null, 0.25) });
      expect(day(scores, 'SKIING', D4)).toEqual({
        date: D4,
        availability: 'UNAVAILABLE',
        score: null,
        rank: null,
        reason: 'Missing usable snow depth (all 9 hours), so skiing cannot be scored.',
        unavailableCode: 'MISSING_ATMOSPHERIC_INPUTS',
      });
      expect(day(scores, 'OUTDOOR_SIGHTSEEING', D4)).toMatchObject({ score: 90 });
      expect(day(scores, 'SKIING', D3).availability).toBe('AVAILABLE');
    });

    it('explains a scored day with its snow depth, temperature and wind', () => {
      const scores = score({ snow_depth: 0.25, temperature_2m: -8, wind_speed_10m: 20 });
      expect(day(scores, 'SKIING', D1)).toMatchObject({
        score: 80,
        reason:
          'Mean snow depth 0.25 m, mean -8.0 °C and wind up to 20.0 km/h from 09:00 to 17:00; ' +
          'snow depth lowers the score most.',
      });
    });
  });

  describe('missing inputs', () => {
    it('needs all nine samples: one missing temperature makes the date unavailable', () => {
      const scores = score({
        temperature_2m: (date, hour) => (date === D2 && hour === 13 ? null : 20),
      });
      for (const activity of ['OUTDOOR_SIGHTSEEING', 'INDOOR_SIGHTSEEING', 'SKIING'] as const) {
        expect(day(scores, activity, D2)).toMatchObject({
          availability: 'UNAVAILABLE',
          unavailableCode: 'MISSING_ATMOSPHERIC_INPUTS',
        });
      }
      expect(day(scores, 'OUTDOOR_SIGHTSEEING', D2).reason).toBe(
        'Missing usable temperature (13:00), so outdoor sightseeing cannot be scored.',
      );
      // Surfing does not use temperature.
      expect(day(scores, 'SURFING', D2).availability).toBe('AVAILABLE');
    });

    it('lists every missing atmospheric field with its hours', () => {
      const scores = score({
        temperature_2m: (date, hour) => (date === D1 && hour === 9 ? null : 20),
        wind_speed_10m: (date, hour) => (date === D1 && (hour === 16 || hour === 17) ? -1 : 25),
      });
      expect(day(scores, 'OUTDOOR_SIGHTSEEING', D1).reason).toBe(
        'Missing usable temperature (09:00) and wind (16:00, 17:00), so outdoor sightseeing ' +
          'cannot be scored.',
      );
    });

    it('ignores nulls outside the sampled hours', () => {
      const scores = score({
        temperature_2m: (_date, hour) => (hour === 18 || hour === 8 ? null : 20),
        precipitation: (_date, hour) => (hour === 9 ? null : 0),
      });
      expect(day(scores, 'OUTDOOR_SIGHTSEEING', D1)).toMatchObject({ score: 90 });
    });

    it('makes a missing wave period unavailable for surfing only', () => {
      const scores = score({}, { wave_period: onDate(D5, null, 12) });
      expect(day(scores, 'SURFING', D5)).toEqual({
        date: D5,
        availability: 'UNAVAILABLE',
        score: null,
        rank: null,
        reason: 'Missing usable wave period (all 9 hours), so surfing cannot be scored.',
        unavailableCode: 'MISSING_MARINE_INPUTS',
      });
      expect(day(scores, 'OUTDOOR_SIGHTSEEING', D5)).toMatchObject({ score: 90 });
    });

    it('reports missing atmospheric wind before missing waves for surfing', () => {
      const scores = score({ wind_speed_10m: null }, { wave_height: null, wave_period: null });
      expect(day(scores, 'SURFING', D1)).toMatchObject({
        unavailableCode: 'MISSING_ATMOSPHERIC_INPUTS',
        reason: 'Missing usable wind (all 9 hours), so surfing cannot be scored.',
      });
    });
  });

  describe('source availability', () => {
    it('keeps atmospheric activities when the marine source is unavailable', () => {
      const scores = score({}, null);
      expect(days(scores, 'SURFING')).toHaveLength(7);
      for (const entry of days(scores, 'SURFING')) {
        expect(entry).toMatchObject({
          availability: 'UNAVAILABLE',
          score: null,
          rank: null,
          unavailableCode: 'MARINE_UNAVAILABLE',
          reason:
            'Marine forecast data is unavailable for the requested dates, so surfing cannot be scored.',
        });
      }
      expect(order(scores, 'OUTDOOR_SIGHTSEEING').map(([, value]) => value)).toEqual(
        Array(7).fill(90),
      );
    });

    it('returns 28 unavailable dated entries when both sources are unavailable', () => {
      const scores = score(null, null);
      const all = scores.activities.flatMap((group) => group.days);
      expect(all).toHaveLength(28);
      for (const entry of all) {
        expect(entry).toMatchObject({
          availability: 'UNAVAILABLE',
          score: null,
          rank: null,
          unavailableCode: 'ATMOSPHERIC_UNAVAILABLE',
        });
      }
      expect(days(scores, 'SKIING').map((entry) => entry.date)).toEqual(WINDOW.dates);
    });

    it('checks sources before measurements', () => {
      // Marine down and atmospheric wind missing: the source failure wins for surfing.
      const scores = score({ wind_speed_10m: null }, null);
      expect(day(scores, 'SURFING', D1).unavailableCode).toBe('MARINE_UNAVAILABLE');
      expect(day(scores, 'OUTDOOR_SIGHTSEEING', D1).unavailableCode).toBe(
        'MISSING_ATMOSPHERIC_INPUTS',
      );
    });

    it('treats a snapshot without the required local hours as an unavailable source', () => {
      const atmospheric = atmosphericForecast(WINDOW);
      const at18 = Date.parse(`${D7}T18:00:00Z`) / 1000;
      const index = atmospheric.hourly.time.indexOf(at18);
      atmospheric.hourly.time.splice(index, 1);
      Object.values(atmospheric.hourly.series).forEach((values) => values.splice(index, 1));
      const scores = scoreActivities({
        window: WINDOW,
        atmospheric,
        marine: marineForecast(WINDOW),
      });
      expect(day(scores, 'OUTDOOR_SIGHTSEEING', D1).unavailableCode).toBe(
        'ATMOSPHERIC_UNAVAILABLE',
      );
    });
  });

  describe('surfing', () => {
    it('uses median waves and the maximum atmospheric wind, citing the grid offset', () => {
      const scores = score(
        { wind_speed_10m: (_date, hour) => (hour === 18 ? 80 : 14.5) },
        {
          wave_height: (_date, hour) => (hour === 12 ? 9 : 1.4),
          wave_period: 11.2,
        },
      );
      expect(day(scores, 'SURFING', D1)).toMatchObject({
        score: 88,
        reason:
          'Median wave height 1.40 m, median period 11.2 s and wind up to 14.5 km/h from 09:00 to 17:00, ' +
          'at a model grid point 3.8 km away; wave height lowers the score most.',
      });
    });

    it('does not change when only temperature changes', () => {
      const base = score({ temperature_2m: 20 });
      const colder = score({ temperature_2m: -10 });
      expect(days(colder, 'SURFING')).toEqual(days(base, 'SURFING'));
      expect(days(colder, 'OUTDOOR_SIGHTSEEING')).not.toEqual(days(base, 'OUTDOOR_SIGHTSEEING'));
    });

    it('accepts a grid point at exactly 25 km', () => {
      const scores = score({}, {}, { requested: ORIGIN, returned: AT_25_KM });
      expect(day(scores, 'SURFING', D1)).toMatchObject({
        availability: 'AVAILABLE',
        score: 90,
        reason: expect.stringContaining('at a model grid point 25.0 km away'),
      });
    });

    it('rejects a grid point just beyond 25 km with a distinct code', () => {
      const scores = score({}, {}, { requested: ORIGIN, returned: JUST_OVER_25_KM });
      for (const entry of days(scores, 'SURFING')) {
        expect(entry).toMatchObject({
          availability: 'UNAVAILABLE',
          unavailableCode: 'MARINE_GRID_TOO_DISTANT',
          reason:
            'The marine model grid point is more than 25 km away, beyond the 25 km limit, so ' +
            'surfing cannot be scored.',
        });
      }
      expect(day(scores, 'OUTDOOR_SIGHTSEEING', D1)).toMatchObject({ score: 90 });
    });

    it('states the distance of a clearly distant grid point', () => {
      const scores = score(
        {},
        {},
        { requested: ORIGIN, returned: { latitude: 0.3, longitude: 0 } },
      );
      expect(day(scores, 'SURFING', D1).reason).toBe(
        'The marine model grid point is 33.4 km away, beyond the 25 km limit, so surfing cannot ' +
          'be scored.',
      );
    });

    it('reports invalid grid coordinates', () => {
      const scores = score({}, {}, { requested: ORIGIN, returned: { latitude: 91, longitude: 0 } });
      expect(day(scores, 'SURFING', D1)).toMatchObject({
        unavailableCode: 'INVALID_MARINE_GRID',
        reason: 'The marine model grid coordinates are invalid, so surfing cannot be scored.',
      });
    });

    it('checks measurements before the grid: distant all-null waves are missing inputs', () => {
      const scores = score(
        {},
        { wave_height: null, wave_period: null },
        { requested: ORIGIN, returned: { latitude: 1, longitude: 0 } },
      );
      expect(day(scores, 'SURFING', D1)).toMatchObject({
        unavailableCode: 'MISSING_MARINE_INPUTS',
        reason:
          'Missing usable wave height (all 9 hours) and wave period (all 9 hours), so surfing ' +
          'cannot be scored.',
      });
    });
  });

  describe('ranking', () => {
    it('breaks ties by ascending date with sequential ranks', () => {
      const ranked = days(score(), 'OUTDOOR_SIGHTSEEING');
      expect(ranked.map((entry) => [entry.date, entry.rank])).toEqual(
        WINDOW.dates.map((date, index) => [date, index + 1]),
      );
    });

    it('orders by rounded score, so a lower unrounded score on an earlier date ranks first', () => {
      // 25.5 km/h scores 89.67 and 25 km/h scores 90.00: both round to 90.
      const winds: Record<string, number> = { [D1]: 30, [D2]: 25, [D3]: 25.5, [D4]: 10 };
      const scores = score({ wind_speed_10m: (date) => winds[date] ?? 40 });
      expect(order(scores, 'OUTDOOR_SIGHTSEEING')).toEqual([
        [D4, 100],
        [D2, 90],
        [D3, 90],
        [D1, 87],
        [D5, 80],
        [D6, 80],
        [D7, 80],
      ]);
      expect(days(scores, 'OUTDOOR_SIGHTSEEING').map((entry) => entry.rank)).toEqual([
        1, 2, 3, 4, 5, 6, 7,
      ]);
    });

    it('ranks indoor sightseeing on its own scores', () => {
      const winds: Record<string, number> = { [D1]: 40, [D2]: 10 };
      const scores = score({ wind_speed_10m: (date) => winds[date] ?? 25 });
      expect(order(scores, 'INDOOR_SIGHTSEEING').slice(0, 2)).toEqual([
        [D1, 60],
        [D3, 55],
      ]);
      expect(order(scores, 'INDOOR_SIGHTSEEING')[6]).toEqual([D2, 50]);
    });

    it('appends unavailable dates in date order after the ranked ones', () => {
      const missing = new Set([D2, D6]);
      const scores = score({
        temperature_2m: (date) => (missing.has(date) ? null : date === D7 ? 15 : 20),
      });
      expect(order(scores, 'OUTDOOR_SIGHTSEEING')).toEqual([
        [D1, 90],
        [D3, 90],
        [D4, 90],
        [D5, 90],
        [D7, 78],
        [D2, null],
        [D6, null],
      ]);
      const tail = days(scores, 'OUTDOOR_SIGHTSEEING').slice(5);
      expect(tail.map((entry) => entry.rank)).toEqual([null, null]);
    });
  });
});
