import { Inject, Injectable, Logger } from '@nestjs/common';
import { HTTP_FETCH, type HttpFetch } from '../http/http-fetch';
import { OpenMeteoForecastClient, type ForecastSourceSpec } from './open-meteo-forecast';

/**
 * Hourly wave height and period from the nearest sea grid cell, sampled at
 * 09:00–17:00 local time. Inland points answer with complete timestamps and
 * entirely null waves; such a payload is valid and stored (ADR 0004).
 * https://open-meteo.com/en/docs/marine-weather-api
 */
export const MARINE_SPEC: ForecastSourceSpec = {
  source: 'MARINE',
  schemaVersion: 1,
  label: 'Marine forecast',
  endpoint: 'https://marine-api.open-meteo.com/v1/marine',
  variables: {
    wave_height: 'm',
    wave_period: 's',
  },
  params: {
    cell_selection: 'sea',
    length_unit: 'metric',
  },
  requiredLocalHours: [9, 10, 11, 12, 13, 14, 15, 16, 17],
};

/** Open-Meteo marine API adapter. */
@Injectable()
export class OpenMeteoMarineClient extends OpenMeteoForecastClient {
  readonly spec = MARINE_SPEC;
  protected readonly logger = new Logger(OpenMeteoMarineClient.name);

  constructor(@Inject(HTTP_FETCH) fetch: HttpFetch) {
    super(fetch);
  }
}
