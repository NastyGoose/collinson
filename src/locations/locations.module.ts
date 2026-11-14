import { Module } from '@nestjs/common';
import { HttpModule } from '../http/http.module';
import { LocationsRepository } from './locations.repository';
import { LocationsService } from './locations.service';
import { OpenMeteoGeocodingClient } from './open-meteo-geocoding.client';

/**
 * Location identity: Open-Meteo geocoding, stable IDs and the search cache.
 * Depends on the global PrismaModule and ClockModule.
 */
@Module({
  imports: [HttpModule],
  providers: [LocationsService, LocationsRepository, OpenMeteoGeocodingClient],
  exports: [LocationsService],
})
export class LocationsModule {}
