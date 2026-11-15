import {
  indoorScore,
  interpolate,
  limitingComponent,
  outdoorScore,
  roundScore,
  skiingScore,
  surfingScore,
} from '../../../src/activity/activity-formula.logic';
import {
  OUTDOOR_TEMPERATURE_C,
  SKI_TEMPERATURE_C,
} from '../../../src/activity/activity-scoring.constants';

describe('interpolate', () => {
  it('is linear between breakpoints and exact at them', () => {
    expect(interpolate(0, OUTDOOR_TEMPERATURE_C)).toBe(0);
    expect(interpolate(10, OUTDOOR_TEMPERATURE_C)).toBe(50);
    expect(interpolate(20, OUTDOOR_TEMPERATURE_C)).toBe(100);
    expect(interpolate(27.5, OUTDOOR_TEMPERATURE_C)).toBe(50);
    expect(interpolate(35, OUTDOOR_TEMPERATURE_C)).toBe(0);
    expect(interpolate(-12.5, SKI_TEMPERATURE_C)).toBe(50);
  });

  it('clamps to the endpoint scores outside the range', () => {
    expect(interpolate(-40, OUTDOOR_TEMPERATURE_C)).toBe(0);
    expect(interpolate(45, OUTDOOR_TEMPERATURE_C)).toBe(0);
    expect(interpolate(-30, SKI_TEMPERATURE_C)).toBe(0);
    expect(interpolate(12, SKI_TEMPERATURE_C)).toBe(0);
  });
});

describe('outdoor and indoor sightseeing', () => {
  it('scores the dry 20 °C, 25 km/h example as 90 outdoors and 55 indoors', () => {
    const outdoor = outdoorScore({ meanTemperatureC: 20, totalPrecipitationMm: 0, maxWindKmh: 25 });
    expect(outdoor.total).toBeCloseTo(90, 10);
    expect(roundScore(outdoor.total)).toBe(90);
    expect(roundScore(indoorScore(outdoor.total))).toBe(55);
  });

  it('weights temperature 50%, precipitation 30% and wind 20%', () => {
    const at = (meanTemperatureC: number, totalPrecipitationMm: number, maxWindKmh: number) =>
      outdoorScore({ meanTemperatureC, totalPrecipitationMm, maxWindKmh }).total;
    expect(at(20, 0, 10)).toBe(100);
    expect(at(35, 0, 10)).toBe(50);
    expect(at(20, 8, 10)).toBe(70);
    expect(at(20, 0, 40)).toBe(80);
    expect(at(0, 8, 40)).toBe(0);
    expect(at(20, 4, 10)).toBe(85);
  });

  it('starts indoors from 50 and adds half of the outdoor shortfall', () => {
    expect(indoorScore(100)).toBe(50);
    expect(indoorScore(0)).toBe(100);
    expect(indoorScore(61)).toBe(69.5);
  });
});

describe('skiing', () => {
  it('scores a measured zero snow depth as 0 whatever the weather', () => {
    expect(skiingScore({ meanSnowDepthM: 0, meanTemperatureC: -5, maxWindKmh: 10 }).total).toBe(0);
  });

  it('weights snow depth 50%, temperature 30% and wind 20%', () => {
    const at = (meanSnowDepthM: number, meanTemperatureC: number, maxWindKmh: number) =>
      skiingScore({ meanSnowDepthM, meanTemperatureC, maxWindKmh }).total;
    expect(at(0.3, -5, 10)).toBe(100);
    expect(at(0.6, -5, 10)).toBe(100);
    expect(at(0.15, -5, 10)).toBeCloseTo(75, 10);
    expect(at(0.3, 5, 10)).toBe(70);
    expect(at(0.3, -5, 45)).toBe(80);
    // 27.5 km/h is half-way from 10 to 45 km/h; 0 °C is half-way down from -5 to 5 °C.
    expect(at(0.3, -5, 27.5)).toBeCloseTo(90, 10);
    expect(at(0.3, 0, 10)).toBeCloseTo(85, 10);
  });

  it('scores a thin but non-zero snow depth on the formula', () => {
    expect(
      skiingScore({ meanSnowDepthM: 0.003, meanTemperatureC: -5, maxWindKmh: 10 }).total,
    ).toBeCloseTo(50.5, 10);
  });
});

describe('surfing', () => {
  it('weights wave height 50%, wave period 30% and wind 20%', () => {
    const at = (medianWaveHeightM: number, medianWavePeriodS: number, maxWindKmh: number) =>
      surfingScore({ medianWaveHeightM, medianWavePeriodS, maxWindKmh }).total;
    expect(at(1.2, 12, 10)).toBe(100);
    expect(at(3, 12, 10)).toBe(50);
    expect(at(0, 12, 10)).toBe(50);
    expect(at(1.2, 4, 10)).toBe(70);
    expect(at(1.2, 16, 10)).toBe(100);
    expect(at(1.2, 12, 40)).toBe(80);
  });

  it('interpolates inside each wave and wind range', () => {
    const at = (medianWaveHeightM: number, medianWavePeriodS: number, maxWindKmh: number) =>
      surfingScore({ medianWaveHeightM, medianWavePeriodS, maxWindKmh }).total;
    // 0.6 m is half-way up to the 1.2 m peak and 2.1 m half-way down to 3 m.
    expect(at(0.6, 12, 10)).toBeCloseTo(75, 10);
    expect(at(2.1, 12, 10)).toBeCloseTo(75, 10);
    // 8 s is half-way from 4 s to 12 s; 25 km/h is half-way from 10 to 40 km/h.
    expect(at(1.2, 8, 10)).toBeCloseTo(85, 10);
    expect(at(1.2, 12, 25)).toBeCloseTo(90, 10);
  });
});

describe('roundScore', () => {
  it('rounds halves up', () => {
    expect(roundScore(89.5)).toBe(90);
    expect(roundScore(55.25)).toBe(55);
    expect(roundScore(69.5)).toBe(70);
    expect(roundScore(0)).toBe(0);
    expect(roundScore(100)).toBe(100);
  });

  it('rounds a half that floating-point arithmetic left just below .5 as a half', () => {
    expect(roundScore(89.49999999999999)).toBe(90);
    expect(roundScore(89.4999)).toBe(89);
  });
});

describe('limitingComponent', () => {
  it('names the factor that costs the most weighted points', () => {
    const score = outdoorScore({ meanTemperatureC: 20, totalPrecipitationMm: 0, maxWindKmh: 25 });
    expect(limitingComponent(score)?.label).toBe('wind');
    const wet = outdoorScore({ meanTemperatureC: 18, totalPrecipitationMm: 6, maxWindKmh: 20 });
    expect(limitingComponent(wet)?.label).toBe('precipitation');
  });

  it('names none when every factor is ideal', () => {
    const ideal = outdoorScore({ meanTemperatureC: 20, totalPrecipitationMm: 0, maxWindKmh: 5 });
    expect(limitingComponent(ideal)).toBeUndefined();
  });
});
