import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { JsonRequestService } from '../http/json-request.service';
import { MARINE_SPEC } from './forecast.constants';
import { OpenMeteoForecastClient } from './open-meteo-forecast.client';

/** Open-Meteo marine API adapter. */
@Injectable()
export class OpenMeteoMarineClient extends OpenMeteoForecastClient {
  readonly spec = MARINE_SPEC;

  constructor(
    http: JsonRequestService,
    @InjectPinoLogger(OpenMeteoMarineClient.name) logger: PinoLogger,
  ) {
    super(http, logger);
  }
}
