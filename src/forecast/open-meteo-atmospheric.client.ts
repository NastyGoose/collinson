import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { JsonRequestService } from '../http/json-request.service';
import { ATMOSPHERIC_SPEC } from './forecast.constants';
import { OpenMeteoForecastClient } from './open-meteo-forecast.client';

/** Open-Meteo forecast API adapter for the atmospheric source. */
@Injectable()
export class OpenMeteoAtmosphericClient extends OpenMeteoForecastClient {
  readonly spec = ATMOSPHERIC_SPEC;

  constructor(
    http: JsonRequestService,
    @InjectPinoLogger(OpenMeteoAtmosphericClient.name) logger: PinoLogger,
  ) {
    super(http, logger);
  }
}
