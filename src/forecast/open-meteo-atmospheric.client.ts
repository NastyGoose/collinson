import { Inject, Injectable, Logger } from '@nestjs/common';
import { HTTP_FETCH } from '../http/http.constants';
import type { HttpFetch } from '../http/http.types';
import { ATMOSPHERIC_SPEC } from './forecast.constants';
import { OpenMeteoForecastClient } from './open-meteo-forecast.client';

/** Open-Meteo forecast API adapter for the atmospheric source. */
@Injectable()
export class OpenMeteoAtmosphericClient extends OpenMeteoForecastClient {
  readonly spec = ATMOSPHERIC_SPEC;
  protected readonly logger = new Logger(OpenMeteoAtmosphericClient.name);

  constructor(@Inject(HTTP_FETCH) fetch: HttpFetch) {
    super(fetch);
  }
}
