import { NEAR_GRID, REQUESTED } from '../../test/fixtures/scoring-weather';
import {
  checkMarineGrid,
  EARTH_RADIUS_KM,
  haversineKm,
  isValidCoordinates,
  isWithinGridLimit,
} from './marine-grid';

const ORIGIN = { latitude: 0, longitude: 0 };
/** Due north of the origin at exactly 25 km on the mean-radius sphere. */
const AT_25_KM = { latitude: 0.2248300909311345, longitude: 0 };
/** The next representable step further north: a hair over 25 km. */
const JUST_OVER_25_KM = { latitude: 0.2248300909311355, longitude: 0 };

describe('haversineKm', () => {
  it('measures along a meridian as the radius times the angle', () => {
    expect(haversineKm(ORIGIN, { latitude: 1, longitude: 0 })).toBeCloseTo(
      (EARTH_RADIUS_KM * Math.PI) / 180,
      9,
    );
  });

  it('is zero for the same point and symmetric', () => {
    expect(haversineKm(REQUESTED, REQUESTED)).toBe(0);
    expect(haversineKm(REQUESTED, NEAR_GRID)).toBe(haversineKm(NEAR_GRID, REQUESTED));
  });

  it('measures across the antimeridian the short way', () => {
    const west = { latitude: 0, longitude: 179.9 };
    const east = { latitude: 0, longitude: -179.9 };
    expect(haversineKm(west, east)).toBeCloseTo((EARTH_RADIUS_KM * 0.2 * Math.PI) / 180, 6);
  });
});

describe('checkMarineGrid', () => {
  it('accepts a nearby grid cell and reports its unrounded distance', () => {
    const check = checkMarineGrid(REQUESTED, NEAR_GRID);
    expect(check).toEqual({ eligible: true, distanceKm: haversineKm(REQUESTED, NEAR_GRID) });
  });

  it('includes a grid cell at exactly 25 km', () => {
    expect(haversineKm(ORIGIN, AT_25_KM)).toBe(25);
    expect(checkMarineGrid(ORIGIN, AT_25_KM)).toEqual({ eligible: true, distanceKm: 25 });
  });

  it('rejects a grid cell beyond 25 km without rounding the distance', () => {
    const distanceKm = haversineKm(ORIGIN, JUST_OVER_25_KM);
    expect(distanceKm).toBeGreaterThan(25);
    expect(distanceKm.toFixed(6)).toBe('25.000000');
    expect(checkMarineGrid(ORIGIN, JUST_OVER_25_KM)).toEqual({
      eligible: false,
      code: 'MARINE_GRID_TOO_DISTANT',
      distanceKm,
    });
  });

  it('compares the distance with an inclusive cap', () => {
    expect(isWithinGridLimit(25)).toBe(true);
    expect(isWithinGridLimit(25.000001)).toBe(false);
    expect(isWithinGridLimit(Number.NaN)).toBe(false);
  });

  it.each([
    ['latitude above 90', { latitude: 90.0001, longitude: 0 }],
    ['latitude below -90', { latitude: -91, longitude: 0 }],
    ['longitude beyond 180', { latitude: 0, longitude: 180.5 }],
    ['a NaN coordinate', { latitude: Number.NaN, longitude: 0 }],
    ['an infinite coordinate', { latitude: 0, longitude: Number.POSITIVE_INFINITY }],
  ])('rejects %s on either side as an invalid grid', (_label, invalid) => {
    expect(isValidCoordinates(invalid)).toBe(false);
    expect(checkMarineGrid(invalid, ORIGIN)).toEqual({
      eligible: false,
      code: 'INVALID_MARINE_GRID',
    });
    expect(checkMarineGrid(ORIGIN, invalid)).toEqual({
      eligible: false,
      code: 'INVALID_MARINE_GRID',
    });
  });

  it('accepts the poles and the antimeridian as valid coordinates', () => {
    expect(isValidCoordinates({ latitude: 90, longitude: 180 })).toBe(true);
    expect(isValidCoordinates({ latitude: -90, longitude: -180 })).toBe(true);
  });
});
