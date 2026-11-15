import { UseFilters } from '@nestjs/common';
import { Args, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { scoreActivities } from '../activity/activity-scoring.logic';
import { Clock } from '../clock/clock.service';
import { forecastWindow } from '../calendar/calendar.logic';
import { ForecastService } from '../forecast/forecast.service';
import type { Location, LocationSelectorInput } from '../location/location.types';
import { LocationService } from '../location/location.service';
import { scoringInputOf, toActivityForecast, toUnresolvedResult } from './activity-forecast.mapper';
import type { ForecastResult } from './activity-forecast.types';
import { DomainErrorFilter } from './activity-forecast.filter';

/**
 * The `locations` and `activityForecast` queries. Orchestrates Locations,
 * Forecasts and Activities and maps their results to the published SDL; it holds
 * no provider, storage or scoring logic of its own. DomainErrorFilter turns
 * location and storage failures into the documented GraphQL error codes.
 */
@Resolver()
@UseFilters(DomainErrorFilter)
export class ActivityForecastResolver {
  constructor(
    private readonly locations: LocationService,
    private readonly forecasts: ForecastService,
    private readonly clock: Clock,
  ) {}

  @Query('locations')
  searchLocations(
    @Args('city') city: string,
    @Args('countryCode') countryCode?: string | null,
  ): Promise<Location[]> {
    return this.locations.search(city, countryCode);
  }

  @Query('activityForecast')
  async activityForecast(@Args('input') input: LocationSelectorInput): Promise<ForecastResult> {
    // Frozen before resolution, so a slow geocoding call or refresh that crosses
    // local midnight cannot shift the dates (ADR 0003).
    const requestedAt = this.clock.now();
    const resolution = await this.locations.resolve(input);
    if (resolution.kind !== 'resolved') {
      return toUnresolvedResult(resolution);
    }
    const { location } = resolution;
    const window = forecastWindow(requestedAt, location.timezone);
    const weather = await this.forecasts.getWeather(location, window);
    const scores = scoreActivities({
      window,
      atmospheric: scoringInputOf(weather.atmospheric),
      marine: scoringInputOf(weather.marine),
    });
    return toActivityForecast(location, weather, scores);
  }
}

@Resolver('ForecastResult')
export class ForecastResultResolver {
  @ResolveField('__resolveType')
  resolveType(result: ForecastResult): ForecastResult['__typename'] {
    return result.__typename;
  }
}
