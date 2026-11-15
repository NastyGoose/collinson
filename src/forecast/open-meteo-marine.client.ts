import { Inject, Injectable, Logger } from '@nestjs/common';
import { HTTP_FETCH } from '../http/http.constants';
import type { HttpFetch } from '../http/http.types';
import { MARINE_SPEC } from './forecast.constants';
import { OpenMeteoForecastClient } from './open-meteo-forecast.client';

/** Open-Meteo marine API adapter. */
@Injectable()
export class OpenMeteoMarineClient extends OpenMeteoForecastClient {
  readonly spec = MARINE_SPEC;
  protected readonly logger = new Logger(OpenMeteoMarineClient.name);

  constructor(@Inject(HTTP_FETCH) fetch: HttpFetch) {
    super(fetch);
  }
}
