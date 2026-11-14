import { Module } from '@nestjs/common';
import { HttpModule } from '../http/http.module';
import { ForecastsRepository } from './forecasts.repository';
import { ForecastsService } from './forecasts.service';
import { OpenMeteoAtmosphericClient } from './open-meteo-atmospheric.client';
import { OpenMeteoMarineClient } from './open-meteo-marine.client';

/**
 * Forecast snapshots: the Open-Meteo atmospheric and marine adapters, normalized
 * persistence and request-driven refresh. Depends on the global PrismaModule and
 * ClockModule.
 */
@Module({
  imports: [HttpModule],
  providers: [
    ForecastsService,
    ForecastsRepository,
    OpenMeteoAtmosphericClient,
    OpenMeteoMarineClient,
  ],
  exports: [ForecastsService],
})
export class ForecastsModule {}
