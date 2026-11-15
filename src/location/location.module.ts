import { Module } from '@nestjs/common';
import { HttpModule } from '../http/http.module';
import { LocationRepository } from './location.repository';
import { LocationService } from './location.service';
import { OpenMeteoGeocodingClient } from './open-meteo-geocoding.client';

/**
 * Location identity: Open-Meteo geocoding, stable IDs and the search cache.
 * Depends on the global PrismaModule and ClockModule.
 */
@Module({
  imports: [HttpModule],
  providers: [LocationService, LocationRepository, OpenMeteoGeocodingClient],
  exports: [LocationService],
})
export class LocationModule {}
