import type { Provider } from '@nestjs/common';
import { getLoggerToken, PinoLogger } from 'nestjs-pino';
import type { HttpFetch } from '../../src/http/http.types';
import { JsonRequestService } from '../../src/http/json-request.service';

/** A real PinoLogger that writes nothing. Spy on its methods to assert on what a class logs. */
export function silentLogger(): PinoLogger {
  return new PinoLogger({ pinoHttp: { level: 'silent' } });
}

/** Supplies the logger that `@InjectPinoLogger(context)` asks for, in a module built without LoggerModule. */
export function loggerProvider(context: string, logger: PinoLogger = silentLogger()): Provider {
  return { provide: getLoggerToken(context), useValue: logger };
}

/** A JsonRequestService over a fixture fetch, logging to `logger`. */
export function jsonRequest(
  fetch: HttpFetch,
  logger: PinoLogger = silentLogger(),
): JsonRequestService {
  return new JsonRequestService(fetch, logger);
}
