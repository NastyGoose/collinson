import { Inject, Injectable, Logger } from '@nestjs/common';
import { HTTP_FETCH, type HttpFetch } from '../http/http-fetch';
import { OpenMeteoForecastClient, type ForecastSourceSpec } from './open-meteo-forecast';

/**
 * Hourly temperature, snow depth, precipitation and 10 m wind in metric units.
 * Instantaneous fields are sampled at 09:00–17:00 and precipitation, which covers
 * the preceding hour, at 10:00–18:00 local time (Technical Design, scoring v1).
 * https://open-meteo.com/en/docs
 */
export const ATMOSPHERIC_SPEC: ForecastSourceSpec = {
  source: 'ATMOSPHERIC',
  schemaVersion: 1,
  label: 'Atmospheric forecast',
  endpoint: 'https://api.open-meteo.com/v1/forecast',
  variables: {
    temperature_2m: '°C',
    snow_depth: 'm',
    precipitation: 'mm',
    wind_speed_10m: 'km/h',
  },
  params: {
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  },
  requiredLocalHours: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
};

/** Open-Meteo forecast API adapter for the atmospheric source. */
@Injectable()
export class OpenMeteoAtmosphericClient extends OpenMeteoForecastClient {
  readonly spec = ATMOSPHERIC_SPEC;
  protected readonly logger = new Logger(OpenMeteoAtmosphericClient.name);

  constructor(@Inject(HTTP_FETCH) fetch: HttpFetch) {
    super(fetch);
  }
}
