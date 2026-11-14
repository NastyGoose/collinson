import type { Coordinates } from '../forecasts/weather-source';

/** Mean Earth radius used for the grid offset (ADR 0004). */
export const EARTH_RADIUS_KM = 6371.0088;

/** Largest accepted distance between the requested point and the marine grid cell, inclusive. */
export const MAX_MARINE_GRID_OFFSET_KM = 25;

export type MarineGridCheck =
  | { eligible: true; distanceKm: number }
  | { eligible: false; code: 'INVALID_MARINE_GRID' }
  | { eligible: false; code: 'MARINE_GRID_TOO_DISTANT'; distanceKm: number };

/**
 * Whether marine model data is close enough to the requested point to score
 * surfing. Both pairs must be valid coordinates; the unrounded haversine distance
 * is compared with an inclusive 25 km cap. The grid point cannot establish
 * coastline distance, beach access or surf safety (ADR 0004).
 */
export function checkMarineGrid(requested: Coordinates, returned: Coordinates): MarineGridCheck {
  if (!isValidCoordinates(requested) || !isValidCoordinates(returned)) {
    return { eligible: false, code: 'INVALID_MARINE_GRID' };
  }
  const distanceKm = haversineKm(requested, returned);
  return isWithinGridLimit(distanceKm)
    ? { eligible: true, distanceKm }
    : { eligible: false, code: 'MARINE_GRID_TOO_DISTANT', distanceKm };
}

export function isWithinGridLimit(distanceKm: number): boolean {
  return distanceKm <= MAX_MARINE_GRID_OFFSET_KM;
}

export function isValidCoordinates({ latitude, longitude }: Coordinates): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

/** Great-circle distance on a sphere of the mean Earth radius. */
export function haversineKm(a: Coordinates, b: Coordinates): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLatitude = toRadians(b.latitude - a.latitude);
  const dLongitude = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLatitude / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) *
      Math.cos(toRadians(b.latitude)) *
      Math.sin(dLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
