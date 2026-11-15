import { Module } from '@nestjs/common';
import { HttpModule } from '../http/http.module';
import { ForecastRepository } from './forecast.repository';
import { ForecastService } from './forecast.service';
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
    ForecastService,
    ForecastRepository,
    OpenMeteoAtmosphericClient,
    OpenMeteoMarineClient,
  ],
  exports: [ForecastService],
})
export class ForecastModule {}
