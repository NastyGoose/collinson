import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { Env } from '../config/config.types';

/**
 * The single Prisma Client for this NestJS process (ADR 0002). Nest calls
 * onModuleDestroy on app.close() and, with enableShutdownHooks(), on
 * SIGINT/SIGTERM, so the connection pool is released before the process exits.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(
    config: ConfigService<Env, true>,
    @InjectPinoLogger(PrismaService.name) private readonly logger: PinoLogger,
  ) {
    super({
      adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL', { infer: true }) }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.info('Prisma Client disconnected');
  }

  /** True when PostgreSQL answers a trivial query. Never throws. */
  async isReachable(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.warn(`PostgreSQL is unreachable: ${(error as Error).message}`);
      return false;
    }
  }
}
