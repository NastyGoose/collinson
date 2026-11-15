import { type DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { Env } from '../config/config.types';

/**
 * The shared logger (ADR 0006): nestjs-pino writing structured JSON lines to
 * stdout at the LOG_LEVEL from the validated configuration, `info` by default.
 * Classes take it by injection with `@InjectPinoLogger(<Class>.name)`; main.ts
 * routes Nest's own logs through it. Per-request access lines are off: the
 * service logs what it does, not every GraphQL POST.
 *
 * Import it as `LoggerModule.forRoot()`. nestjs-pino creates one provider per
 * `@InjectPinoLogger` context that has been declared when its own module is
 * built, so that must happen while the module graph is assembled, after every
 * class has been loaded, not when this file is first imported.
 *
 * The test tiers set LOG_LEVEL to `silent` unless it is already set
 * (test/support/silent-logs.ts), so a test run opts in with LOG_LEVEL=debug.
 * Depends on the global ConfigModule.
 */
@Module({})
export class LoggerModule {
  static forRoot(): DynamicModule {
    return {
      module: LoggerModule,
      imports: [
        PinoLoggerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService<Env, true>) => ({
            pinoHttp: { level: config.get('LOG_LEVEL', { infer: true }), autoLogging: false },
          }),
        }),
      ],
    };
  }
}
