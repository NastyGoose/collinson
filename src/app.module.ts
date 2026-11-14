import { join } from 'node:path';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ClockModule } from './clock/clock.module';
import { validateEnv } from './config/env';
import { ForecastsModule } from './forecasts/forecasts.module';
import { HealthModule } from './health/health.module';
import { LocationsModule } from './locations/locations.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    // Schema-first: the SDL files next to each module are the published contract.
    // __dirname is src/ under ts-jest and dist/ after `nest build`, which copies the
    // .graphql assets (nest-cli.json), so the same glob works in both.
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      typePaths: [join(__dirname, '**/*.graphql')],
    }),
    PrismaModule,
    ClockModule,
    HealthModule,
    LocationsModule,
    ForecastsModule,
  ],
})
export class AppModule {}
