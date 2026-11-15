import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { Env } from './config/config.types';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Runs onModuleDestroy (Prisma disconnect) on SIGINT/SIGTERM.
  app.enableShutdownHooks();

  const port = app.get(ConfigService<Env, true>).get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(`GraphQL endpoint: http://localhost:${port}/graphql`, 'Bootstrap');
}

void bootstrap();
