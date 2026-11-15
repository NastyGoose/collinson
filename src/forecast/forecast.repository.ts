import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { ForecastSnapshot as SnapshotRow, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isStorageFailure } from '../prisma/prisma.errors';
import { ForecastStorageUnavailableError } from './forecast.errors';
import type { HourlySeries, WeatherSnapshot, WeatherSource } from './forecast.types';

/**
 * PostgreSQL access for forecast snapshots. An unreachable or failing database
 * surfaces as ForecastStorageUnavailableError; other Prisma errors are rethrown
 * unchanged. No method calls a provider.
 */
@Injectable()
export class ForecastRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(ForecastRepository.name) private readonly logger: PinoLogger,
  ) {}

  /** The stored snapshot for this key, or null when there is none or it cannot be read back. */
  findSnapshot(
    locationId: string,
    source: WeatherSource,
    schemaVersion: number,
  ): Promise<WeatherSnapshot | null> {
    return this.storage('read a forecast snapshot', async () => {
      const row = await this.prisma.forecastSnapshot.findUnique({
        where: { locationId_source_schemaVersion: { locationId, source, schemaVersion } },
      });
      return row === null ? null : this.toSnapshot(row);
    });
  }

  /**
   * Replaces the snapshot for its (location, source, schema version) key with one
   * INSERT … ON CONFLICT DO UPDATE statement, so a reader sees either the previous
   * row or the new one, never a mix. Callers validate the snapshot first and call
   * the provider before this: no upstream I/O runs inside the statement.
   */
  saveSnapshot(snapshot: WeatherSnapshot): Promise<void> {
    const key = {
      locationId: snapshot.locationId,
      source: snapshot.source,
      schemaVersion: snapshot.schemaVersion,
    };
    const fields = {
      fetchedAt: snapshot.fetchedAt,
      coverageStart: snapshot.coverageStart,
      coverageEnd: snapshot.coverageEnd,
      requestedLatitude: snapshot.requested.latitude,
      requestedLongitude: snapshot.requested.longitude,
      returnedLatitude: snapshot.returned.latitude,
      returnedLongitude: snapshot.returned.longitude,
      timezone: snapshot.timezone,
      units: { ...snapshot.units },
      hourly: { time: snapshot.hourly.time, series: { ...snapshot.hourly.series } },
    } satisfies Prisma.ForecastSnapshotUpdateInput;
    return this.storage('save a forecast snapshot', async () => {
      await this.prisma.forecastSnapshot.upsert({
        where: { locationId_source_schemaVersion: key },
        create: { ...key, ...fields },
        update: fields,
      });
    });
  }

  private toSnapshot(row: SnapshotRow): WeatherSnapshot | null {
    const hourly = asHourlySeries(row.hourly);
    const units = asUnits(row.units);
    if (hourly === null || units === null) {
      // Written by this service, so only a manual edit gets here; a refresh replaces it.
      this.logger.warn(
        `Ignoring an unreadable ${row.source} snapshot for location ${row.locationId}`,
      );
      return null;
    }
    return {
      locationId: row.locationId,
      source: row.source,
      schemaVersion: row.schemaVersion,
      fetchedAt: row.fetchedAt,
      coverageStart: row.coverageStart,
      coverageEnd: row.coverageEnd,
      requested: { latitude: row.requestedLatitude, longitude: row.requestedLongitude },
      returned: { latitude: row.returnedLatitude, longitude: row.returnedLongitude },
      timezone: row.timezone,
      units,
      hourly,
    };
  }

  /**
   * Runs a database operation and reports an unreachable or failing database as
   * ForecastStorageUnavailableError. Anything else is rethrown unchanged.
   */
  private async storage<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!isStorageFailure(error)) {
        throw error;
      }
      this.logger.error({ err: error }, `Could not ${operation}`);
      throw new ForecastStorageUnavailableError(`Could not ${operation}.`, { cause: error });
    }
  }
}

function asHourlySeries(value: Prisma.JsonValue): HourlySeries | null {
  if (!isJsonObject(value) || !Array.isArray(value.time) || !isJsonObject(value.series)) {
    return null;
  }
  const time: number[] = [];
  for (const instant of value.time) {
    if (typeof instant !== 'number') {
      return null;
    }
    time.push(instant);
  }
  const series: HourlySeries['series'] = {};
  for (const [variable, samples] of Object.entries(value.series)) {
    if (!Array.isArray(samples) || samples.length !== time.length) {
      return null;
    }
    const values: (number | null)[] = [];
    for (const sample of samples) {
      if (sample !== null && typeof sample !== 'number') {
        return null;
      }
      values.push(sample);
    }
    series[variable] = values;
  }
  return { time, series };
}

function asUnits(value: Prisma.JsonValue): Record<string, string> | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const units: Record<string, string> = {};
  for (const [variable, unit] of Object.entries(value)) {
    if (typeof unit !== 'string') {
      return null;
    }
    units[variable] = unit;
  }
  return units;
}

function isJsonObject(value: Prisma.JsonValue | undefined): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
