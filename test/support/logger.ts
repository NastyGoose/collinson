import type { Provider } from '@nestjs/common';
import { getLoggerToken, PinoLogger } from 'nestjs-pino';

/**
 * A real PinoLogger that writes nothing. Spy on its methods to assert on what a class logs.
 * nestjs-pino shares one root logger per spec file, and the first logger built sets its
 * level, so do not mix this with LoggerModule.forRoot() in one spec.
 */
export function silentLogger(): PinoLogger {
  return new PinoLogger({ pinoHttp: { level: 'silent' } });
}

/** Supplies the logger that `@InjectPinoLogger(context)` asks for, in a module built without LoggerModule. */
export function loggerProvider(context: string, logger: PinoLogger = silentLogger()): Provider {
  return { provide: getLoggerToken(context), useValue: logger };
}
