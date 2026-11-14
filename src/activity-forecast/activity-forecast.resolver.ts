import { Args, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { scoreActivities } from '../activities/activity-scoring';
import { Clock } from '../clock/clock';
import { forecastWindow } from '../forecasts/forecast-window';
import { ForecastsService } from '../forecasts/forecasts.service';
import type { Location } from '../locations/location';
import type { LocationSelectorInput } from '../locations/location-input';
import { LocationsService } from '../locations/locations.service';
import {
  scoringInputOf,
  toActivityForecast,
  toUnresolvedResult,
  type ForecastResult,
} from './activity-forecast.mapper';
import { toGraphQLError } from './graphql-errors';

/**
 * The `locations` and `activityForecast` queries. Orchestrates Locations,
 * Forecasts and Activities and maps their results to the published SDL; it holds
 * no provider, storage or scoring logic of its own.
 */
@Resolver()
export class ActivityForecastResolver {
  constructor(
    private readonly locations: LocationsService,
    private readonly forecasts: ForecastsService,
    private readonly clock: Clock,
  ) {}

  @Query('locations')
  async searchLocations(
    @Args('city') city: string,
    @Args('countryCode') countryCode?: string | null,
  ): Promise<Location[]> {
    try {
      return await this.locations.search(city, countryCode);
    } catch (error) {
      throw toGraphQLError(error);
    }
  }

  @Query('activityForecast')
  async activityForecast(@Args('input') input: LocationSelectorInput): Promise<ForecastResult> {
    // Frozen before resolution, so a slow geocoding call or refresh that crosses
    // local midnight cannot shift the dates (ADR 0003).
    const requestedAt = this.clock.now();
    try {
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
      return toActivityForecast(location, window, weather, scores);
    } catch (error) {
      throw toGraphQLError(error);
    }
  }
}

@Resolver('ForecastResult')
export class ForecastResultResolver {
  @ResolveField('__resolveType')
  resolveType(result: ForecastResult): ForecastResult['__typename'] {
    return result.__typename;
  }
}
