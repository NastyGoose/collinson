import { PENICHE } from '../../fixtures/open-meteo-weather';
import { atmosphericForecast, marineForecast } from '../../fixtures/scoring-weather';
import { FixedClock } from '../../support/fixed-clock';
import { ForecastStorageUnavailableError } from '../../../src/forecasts/forecast.errors';
import { forecastWindow } from '../../../src/calendar/calendar.logic';
import type { ForecastWindow } from '../../../src/calendar/calendar.types';
import type {
  ForecastsService,
  ForecastWeather,
  SourceResult,
} from '../../../src/forecasts/forecasts.service';
import type { NormalizedForecast, WeatherSource } from '../../../src/forecasts/weather-source';
import type { Location } from '../../../src/locations/location';
import {
  GeocodingUnavailableError,
  InvalidLocationInputError,
  StorageUnavailableError,
} from '../../../src/locations/location.errors';
import type { LocationsService } from '../../../src/locations/locations.service';
import {
  ATTRIBUTION,
  type ActivityForecast,
} from '../../../src/activity-forecast/activity-forecast.mapper';
import {
  ActivityForecastResolver,
  ForecastResultResolver,
} from '../../../src/activity-forecast/activity-forecast.resolver';

/** Lisbon is UTC+0 in November: 23:59:30 local is a moment before midnight. */
const BEFORE_MIDNIGHT = '2026-11-14T23:59:30.000Z';
const FETCHED_AT = '2026-11-14T22:00:00.000Z';
const WINDOW = forecastWindow(new Date(BEFORE_MIDNIGHT), PENICHE.timezone);

const OTHER: Location = { ...PENICHE, id: '2267057', name: 'Lisbon', region: 'Lisbon' };

function fresh(forecast: NormalizedForecast): SourceResult {
  return {
    source: forecast.source,
    freshness: 'FRESH',
    snapshot: { ...forecast, locationId: PENICHE.id, fetchedAt: new Date(FETCHED_AT) },
  };
}

function timedOut(source: WeatherSource): SourceResult {
  return {
    source,
    freshness: 'UNAVAILABLE',
    failure: { code: 'TIMEOUT', reason: `${source} timed out.` },
  };
}

function setup() {
  const clock = new FixedClock(BEFORE_MIDNIGHT);
  const locations = { search: jest.fn(), resolve: jest.fn() };
  const forecasts = { getWeather: jest.fn() };
  const resolver = new ActivityForecastResolver(
    locations as unknown as LocationsService,
    forecasts as unknown as ForecastsService,
    clock,
  );
  locations.resolve.mockResolvedValue({ kind: 'resolved', location: PENICHE });
  forecasts.getWeather.mockImplementation(
    async (_location: Location, window: ForecastWindow): Promise<ForecastWeather> => ({
      window,
      atmospheric: fresh(atmosphericForecast(window)),
      marine: fresh(marineForecast(window)),
    }),
  );
  return { clock, locations, forecasts, resolver };
}

async function forecastOf(resolver: ActivityForecastResolver): Promise<ActivityForecast> {
  const result = await resolver.activityForecast({ city: 'Peniche' });
  if (result.__typename !== 'ActivityForecast') {
    throw new Error(`expected an ActivityForecast, got ${result.__typename}`);
  }
  return result;
}

describe('ActivityForecastResolver.activityForecast', () => {
  it('ranks the window frozen before the location resolved, even past local midnight', async () => {
    const { clock, locations, forecasts, resolver } = setup();
    locations.resolve.mockImplementation(async () => {
      clock.advance(60_000);
      return { kind: 'resolved', location: PENICHE };
    });

    const result = await forecastOf(resolver);

    expect(forecasts.getWeather).toHaveBeenCalledWith(PENICHE, WINDOW);
    expect(result.startDate).toBe('2026-11-15');
    expect(result.endDate).toBe('2026-11-21');
    for (const ranking of result.activities) {
      expect(ranking.days.map((day) => day.date).sort()).toEqual(WINDOW.dates);
    }
  });

  it('returns the location, four ranked groups, both sources, the version and attribution', async () => {
    const { resolver } = setup();

    const result = await forecastOf(resolver);

    expect(result.location).toEqual(PENICHE);
    expect(result.scoringVersion).toBe('v1');
    expect(result.attribution).toBe(ATTRIBUTION);
    expect(result.activities.map((ranking) => ranking.activity)).toEqual([
      'SKIING',
      'SURFING',
      'OUTDOOR_SIGHTSEEING',
      'INDOOR_SIGHTSEEING',
    ]);
    const outdoor = result.activities[2].days;
    expect(outdoor.map((day) => [day.score, day.rank])).toEqual(
      [1, 2, 3, 4, 5, 6, 7].map((rank) => [90, rank]),
    );
    expect(result.sources).toEqual([
      {
        source: 'ATMOSPHERIC',
        freshness: 'FRESH',
        fetchedAt: FETCHED_AT,
        failureCode: null,
        reason: null,
      },
      {
        source: 'MARINE',
        freshness: 'FRESH',
        fetchedAt: FETCHED_AT,
        failureCode: null,
        reason: null,
      },
    ]);
  });

  it('keeps the atmospheric rankings when only the marine source is unavailable', async () => {
    const { forecasts, resolver } = setup();
    forecasts.getWeather.mockImplementation(
      async (_location: Location, window: ForecastWindow) => ({
        window,
        atmospheric: fresh(atmosphericForecast(window)),
        marine: timedOut('MARINE'),
      }),
    );

    const result = await forecastOf(resolver);

    const [skiing, surfing, outdoor, indoor] = result.activities;
    for (const ranking of [skiing, outdoor, indoor]) {
      expect(ranking.days.every((day) => day.availability === 'AVAILABLE')).toBe(true);
    }
    expect(surfing.days).toHaveLength(7);
    for (const day of surfing.days) {
      expect(day).toMatchObject({ score: null, rank: null, unavailableCode: 'MARINE_UNAVAILABLE' });
    }
    expect(result.sources[1]).toEqual({
      source: 'MARINE',
      freshness: 'UNAVAILABLE',
      fetchedAt: null,
      failureCode: 'TIMEOUT',
      reason: 'MARINE timed out.',
    });
  });

  it('returns 28 unavailable dated entries when both sources are down', async () => {
    const { forecasts, resolver } = setup();
    forecasts.getWeather.mockImplementation(
      async (_location: Location, window: ForecastWindow) => ({
        window,
        atmospheric: timedOut('ATMOSPHERIC'),
        marine: timedOut('MARINE'),
      }),
    );

    const result = await forecastOf(resolver);

    const days = result.activities.flatMap((ranking) => ranking.days);
    expect(days).toHaveLength(28);
    for (const day of days) {
      expect(day).toMatchObject({ availability: 'UNAVAILABLE', score: null, rank: null });
    }
    // Atmosphere is checked first, so surfing reports it too (ADR 0005 precedence).
    expect(new Set(days.map((day) => day.unavailableCode))).toEqual(
      new Set(['ATMOSPHERIC_UNAVAILABLE']),
    );
    expect(result.sources.map((source) => [source.source, source.freshness])).toEqual([
      ['ATMOSPHERIC', 'UNAVAILABLE'],
      ['MARINE', 'UNAVAILABLE'],
    ]);
  });

  it('returns the candidates of an ambiguous city without reading weather', async () => {
    const { locations, forecasts, resolver } = setup();
    locations.resolve.mockResolvedValue({ kind: 'ambiguous', candidates: [PENICHE, OTHER] });

    await expect(resolver.activityForecast({ city: 'Peniche' })).resolves.toEqual({
      __typename: 'AmbiguousLocation',
      candidates: [PENICHE, OTHER],
    });
    expect(forecasts.getWeather).not.toHaveBeenCalled();
  });

  it('returns a typed not-found result', async () => {
    const { locations, forecasts, resolver } = setup();
    locations.resolve.mockResolvedValue({ kind: 'not_found', message: 'No location matches.' });

    await expect(resolver.activityForecast({ locationId: '1' })).resolves.toEqual({
      __typename: 'LocationNotFound',
      message: 'No location matches.',
    });
    expect(forecasts.getWeather).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid input', new InvalidLocationInputError('city is too short.', 'city')],
    ['a geocoding failure', new GeocodingUnavailableError('TIMEOUT', 'Geocoding timed out.')],
    ['a location storage failure', new StorageUnavailableError('Could not read.')],
  ])('leaves %s while resolving to DomainErrorFilter', async (_name, failure) => {
    const { locations, forecasts, resolver } = setup();
    locations.resolve.mockRejectedValue(failure);

    await expect(resolver.activityForecast({ city: 'x' })).rejects.toBe(failure);
    expect(forecasts.getWeather).not.toHaveBeenCalled();
  });

  it('leaves a forecast storage failure to DomainErrorFilter', async () => {
    const { forecasts, resolver } = setup();
    const failure = new ForecastStorageUnavailableError('Could not read a forecast snapshot.');
    forecasts.getWeather.mockRejectedValue(failure);

    await expect(resolver.activityForecast({ city: 'Peniche' })).rejects.toBe(failure);
  });
});

describe('ActivityForecastResolver.searchLocations', () => {
  it('returns the candidates the location service finds', async () => {
    const { locations, resolver } = setup();
    locations.search.mockResolvedValue([PENICHE, OTHER]);

    await expect(resolver.searchLocations('Peniche', 'pt')).resolves.toEqual([PENICHE, OTHER]);
    expect(locations.search).toHaveBeenCalledWith('Peniche', 'pt');
  });
});

describe('ForecastResultResolver', () => {
  it('resolves the union member from the result tag', () => {
    const resolver = new ForecastResultResolver();

    expect(resolver.resolveType({ __typename: 'LocationNotFound', message: 'none' })).toBe(
      'LocationNotFound',
    );
  });
});
