import { join } from 'node:path';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { GraphQLModule } from '@nestjs/graphql';
import { ActivityForecastModule } from './activity-forecast/activity-forecast.module';
import { formatGraphQLError } from './activity-forecast/activity-forecast-error.mapper';
import { RequestBodyErrorFilter } from './activity-forecast/activity-forecast-request-body.filter';
import { ClockModule } from './clock/clock.module';
import { validateEnv } from './config/config.logic';
import type { Env } from './config/config.types';
import { HealthModule } from './health/health.module';
import { LoggerModule } from './logger/logger.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggerModule.forRoot(),
    // Schema-first: the SDL files next to each module are the published contract.
    // __dirname is src/ under ts-jest and dist/ after `nest build`, which copies the
    // .graphql assets (nest-cli.json), so the same glob works in both.
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): ApolloDriverConfig => ({
        typePaths: [join(__dirname, '**/*.graphql')],
        // GRAPHQL_INTROSPECTION, off by default when NODE_ENV is production (ARC-59).
        introspection: config.get('GRAPHQL_INTROSPECTION', { infer: true }),
        // Clients get documented codes and safe messages only (SPEC-04).
        includeStacktraceInErrorResponses: false,
        formatError: formatGraphQLError,
      }),
    }),
    PrismaModule,
    ClockModule,
    HealthModule,
    ActivityForecastModule,
  ],
  // Malformed request bodies get a fixed GraphQL-shaped 4xx answer (ARC-59).
  providers: [{ provide: APP_FILTER, useClass: RequestBodyErrorFilter }],
})
export class AppModule {}
