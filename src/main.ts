import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { Env } from './config/config.types';

async function bootstrap(): Promise<void> {
  // Buffered until the pino logger takes over, so startup lines are JSON too.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  // Runs onModuleDestroy (Prisma disconnect) on SIGINT/SIGTERM.
  app.enableShutdownHooks();

  const port = app.get(ConfigService<Env, true>).get('PORT', { infer: true });
  await app.listen(port);
  logger.log(`GraphQL endpoint: http://localhost:${port}/graphql`, 'Bootstrap');
}

void bootstrap();
