import { Module } from '@nestjs/common';
import { ForecastsModule } from '../forecasts/forecasts.module';
import { LocationsModule } from '../locations/locations.module';
import { ActivityForecastResolver, ForecastResultResolver } from './activity-forecast.resolver';

/**
 * The GraphQL consumer contract (SPEC-04): location search and the seven-day
 * activity forecast. Depends on the global ClockModule.
 */
@Module({
  imports: [LocationsModule, ForecastsModule],
  providers: [ActivityForecastResolver, ForecastResultResolver],
})
export class ActivityForecastModule {}
