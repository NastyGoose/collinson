import { Module } from '@nestjs/common';
import { ForecastModule } from '../forecast/forecast.module';
import { LocationModule } from '../location/location.module';
import { ActivityForecastResolver, ForecastResultResolver } from './activity-forecast.resolver';

/**
 * The GraphQL consumer contract (SPEC-04): location search and the seven-day
 * activity forecast. Depends on the global ClockModule.
 */
@Module({
  imports: [LocationModule, ForecastModule],
  providers: [ActivityForecastResolver, ForecastResultResolver],
})
export class ActivityForecastModule {}
