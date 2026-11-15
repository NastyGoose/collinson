import type { PinoLogger } from 'nestjs-pino';
import type { HttpFetch } from '../../src/http/http.types';
import { JsonRequestService } from '../../src/http/json-request.service';
import { silentLogger } from './logger';

/** A JsonRequestService over a fixture fetch, logging to `logger`. */
export function jsonRequest(
  fetch: HttpFetch,
  logger: PinoLogger = silentLogger(),
): JsonRequestService {
  return new JsonRequestService(fetch, logger);
}
