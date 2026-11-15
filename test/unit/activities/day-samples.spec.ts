import {
  atmosphericForecast,
  marineForecast,
  withoutInstant,
} from '../../fixtures/scoring-weather';
import { ATMOSPHERIC_SPEC } from '../../../src/forecasts/open-meteo-atmospheric.client';
import { MARINE_SPEC } from '../../../src/forecasts/open-meteo-marine.client';
import { forecastWindow } from '../../../src/calendar/calendar.logic';
import {
  INSTANT_HOURS,
  max,
  mean,
  median,
  PRECIPITATION_HOURS,
  REQUIRED_SAMPLES,
  sampleSource,
  scoringHours,
  sum,
} from '../../../src/activities/day-samples';

const LISBON = forecastWindow(new Date('2026-11-14T12:00:00Z'), 'Europe/Lisbon');
const DAY = LISBON.dates[0];

describe('scoring hours', () => {
  it('reads nine instantaneous hours from 09:00 and nine precipitation hours ending at 18:00', () => {
    expect(INSTANT_HOURS).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(PRECIPITATION_HOURS).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(INSTANT_HOURS).toHaveLength(REQUIRED_SAMPLES);
    expect(PRECIPITATION_HOURS).toHaveLength(REQUIRED_SAMPLES);
  });

  it('needs 09:00–18:00 from the atmospheric source and 09:00–17:00 from the marine source', () => {
    expect(scoringHours('ATMOSPHERIC')).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(scoringHours('MARINE')).toEqual(INSTANT_HOURS);
  });

  it('matches the hours the forecast service requires before it reports a source fresh', () => {
    expect(scoringHours('ATMOSPHERIC')).toEqual(ATMOSPHERIC_SPEC.requiredLocalHours);
    expect(scoringHours('MARINE')).toEqual(MARINE_SPEC.requiredLocalHours);
  });
});

describe('sampleSource', () => {
  it('returns the nine values at the exact local hours of the date', () => {
    const forecast = atmosphericForecast(LISBON, { temperature_2m: (_date, hour) => hour });
    const samples = sampleSource('ATMOSPHERIC', forecast, LISBON);
    expect(samples?.field('temperature_2m', DAY)).toEqual({ usable: true, values: INSTANT_HOURS });
  });

  it('indexes precipitation by the end of each hour: 18:00 is in, 09:00 is out', () => {
    const forecast = atmosphericForecast(LISBON, { precipitation: (_date, hour) => hour });
    const samples = sampleSource('ATMOSPHERIC', forecast, LISBON);
    expect(samples?.field('precipitation', DAY)).toEqual({
      usable: true,
      values: PRECIPITATION_HOURS,
    });
  });

  it('matches local hours in a zone offset from UTC', () => {
    const warsaw = forecastWindow(new Date('2026-11-14T12:00:00Z'), 'Europe/Warsaw');
    const forecast = atmosphericForecast(warsaw, { wind_speed_10m: (_date, hour) => hour });
    const samples = sampleSource('ATMOSPHERIC', forecast, warsaw);
    expect(samples?.field('wind_speed_10m', warsaw.dates[0])).toEqual({
      usable: true,
      values: INSTANT_HOURS,
    });
  });

  it('matches local hours in a zone with a half-hour offset', () => {
    const kolkata = forecastWindow(new Date('2026-11-14T12:00:00Z'), 'Asia/Kolkata');
    const forecast = atmosphericForecast(kolkata, { temperature_2m: (_date, hour) => hour });
    const samples = sampleSource('ATMOSPHERIC', forecast, kolkata);
    expect(samples?.field('temperature_2m', kolkata.dates[0])).toEqual({
      usable: true,
      values: INSTANT_HOURS,
    });
  });

  it('reads the local hours on both sides of a DST change', () => {
    // Europe/Lisbon moves from UTC+0 to UTC+1 on 2027-03-28 at 01:00 UTC.
    const spring = forecastWindow(new Date('2027-03-25T12:00:00Z'), 'Europe/Lisbon');
    const forecast = atmosphericForecast(spring, { temperature_2m: (_date, hour) => hour });
    const samples = sampleSource('ATMOSPHERIC', forecast, spring);
    for (const date of ['2027-03-27', '2027-03-28', '2027-03-29']) {
      expect(samples?.field('temperature_2m', date)).toEqual({
        usable: true,
        values: INSTANT_HOURS,
      });
    }
  });

  it('keeps a measured zero', () => {
    const forecast = atmosphericForecast(LISBON, { snow_depth: 0, temperature_2m: 0 });
    const samples = sampleSource('ATMOSPHERIC', forecast, LISBON);
    expect(samples?.field('snow_depth', DAY)).toEqual({ usable: true, values: Array(9).fill(0) });
    expect(samples?.field('temperature_2m', DAY)).toEqual({
      usable: true,
      values: Array(9).fill(0),
    });
  });

  it('reports each hour whose value is null, non-finite or impossibly negative', () => {
    const forecast = atmosphericForecast(LISBON, {
      snow_depth: (_date, hour) => (hour === 9 ? null : hour === 12 ? -0.01 : 0.2),
      wind_speed_10m: (_date, hour) => (hour === 17 ? Number.NaN : 12),
      precipitation: (_date, hour) => (hour === 18 ? Number.POSITIVE_INFINITY : 0),
    });
    const samples = sampleSource('ATMOSPHERIC', forecast, LISBON);
    expect(samples?.field('snow_depth', DAY)).toEqual({ usable: false, missingHours: [9, 12] });
    expect(samples?.field('wind_speed_10m', DAY)).toEqual({ usable: false, missingHours: [17] });
    expect(samples?.field('precipitation', DAY)).toEqual({ usable: false, missingHours: [18] });
  });

  it('treats negative precipitation, wave height and wave period as missing', () => {
    const atmospheric = atmosphericForecast(LISBON, {
      precipitation: (_date, hour) => (hour === 14 ? -0.1 : 0),
    });
    expect(sampleSource('ATMOSPHERIC', atmospheric, LISBON)?.field('precipitation', DAY)).toEqual({
      usable: false,
      missingHours: [14],
    });
    const marine = marineForecast(LISBON, {
      wave_height: (_date, hour) => (hour === 10 ? -1 : 1.2),
      wave_period: (_date, hour) => (hour === 11 ? -8 : 12),
    });
    const samples = sampleSource('MARINE', marine, LISBON);
    expect(samples?.field('wave_height', DAY)).toEqual({ usable: false, missingHours: [10] });
    expect(samples?.field('wave_period', DAY)).toEqual({ usable: false, missingHours: [11] });
  });

  it('accepts a negative temperature', () => {
    const forecast = atmosphericForecast(LISBON, { temperature_2m: -12.5 });
    const samples = sampleSource('ATMOSPHERIC', forecast, LISBON);
    expect(samples?.field('temperature_2m', DAY)).toEqual({
      usable: true,
      values: Array(9).fill(-12.5),
    });
  });

  it('ignores values outside the scoring hours', () => {
    const forecast = atmosphericForecast(LISBON, {
      temperature_2m: (_date, hour) => (hour === 8 || hour === 18 ? null : 15),
      precipitation: (_date, hour) => (hour === 9 ? null : 0),
    });
    const samples = sampleSource('ATMOSPHERIC', forecast, LISBON);
    expect(samples?.field('temperature_2m', DAY).usable).toBe(true);
    expect(samples?.field('precipitation', DAY).usable).toBe(true);
  });

  it('treats a series absent from the snapshot as missing at every hour', () => {
    const forecast = marineForecast(LISBON);
    delete forecast.hourly.series.wave_period;
    const samples = sampleSource('MARINE', forecast, LISBON);
    expect(samples?.field('wave_period', DAY)).toEqual({
      usable: false,
      missingHours: INSTANT_HOURS,
    });
  });

  it('returns null for an unavailable source', () => {
    expect(sampleSource('MARINE', null, LISBON)).toBeNull();
  });

  it('returns null when a required local hour has no instant', () => {
    const at18 = Date.parse(`${LISBON.dates[6]}T18:00:00Z`) / 1000;
    const forecast = atmosphericForecast(LISBON);
    withoutInstant(forecast, at18);
    expect(sampleSource('ATMOSPHERIC', forecast, LISBON)).toBeNull();
    // The marine source never reads 18:00, so the same gap leaves it covered.
    const marine = marineForecast(LISBON);
    withoutInstant(marine, at18);
    expect(sampleSource('MARINE', marine, LISBON)).not.toBeNull();
  });

  it('rejects a forecast for another source or time zone', () => {
    expect(() => sampleSource('MARINE', atmosphericForecast(LISBON), LISBON)).toThrow(
      'Expected a MARINE forecast',
    );
    const warsaw = forecastWindow(new Date('2026-11-14T12:00:00Z'), 'Europe/Warsaw');
    expect(() => sampleSource('ATMOSPHERIC', atmosphericForecast(warsaw), LISBON)).toThrow(
      'is in Europe/Warsaw',
    );
  });
});

describe('aggregates', () => {
  it('takes the mean, total, maximum and median', () => {
    const values = [3, 1, 4, 1, 5, 9, 2, 6, 5];
    expect(mean(values)).toBeCloseTo(4, 10);
    expect(sum(values)).toBe(36);
    expect(max(values)).toBe(9);
    expect(median(values)).toBe(4);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
