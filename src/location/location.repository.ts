import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Location as LocationRow } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isStorageFailure } from '../prisma/prisma.errors';
import { PURGE_BATCH_SIZE } from './location.constants';
import type { CachedSearch, Location } from './location.types';
import { StorageUnavailableError } from './location.errors';

/**
 * PostgreSQL access for locations and the search cache. Every database failure
 * surfaces as StorageUnavailableError. No method calls the geocoding provider.
 */
@Injectable()
export class LocationRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(LocationRepository.name) private readonly logger: PinoLogger,
  ) {}

  findLocation(id: string): Promise<Location | null> {
    return this.storage('read a stored location', async () => {
      const row = await this.prisma.location.findUnique({ where: { id } });
      return row === null ? null : toLocation(row);
    });
  }

  /** The cached search for this key, or null when there is none or it has expired at `now`. */
  findFreshSearch(
    query: string,
    countryCode: string | null,
    now: Date,
  ): Promise<CachedSearch | null> {
    return this.storage('read the location search cache', async () => {
      const search = await this.prisma.locationSearch.findUnique({
        where: { query_countryCode: { query, countryCode: countryKey(countryCode) } },
        include: { results: { orderBy: { position: 'asc' }, include: { location: true } } },
      });
      if (search === null || search.expiresAt.getTime() <= now.getTime()) {
        return null;
      }
      return {
        candidates: search.results.map((result) => toLocation(result.location)),
        fetchedAt: search.fetchedAt,
        expiresAt: search.expiresAt,
      };
    });
  }

  /**
   * Upserts the candidates by their stable IDs and replaces the cached search with
   * them, in order, in one transaction. Callers fetch from the provider first:
   * no upstream I/O happens inside the transaction.
   */
  saveSearch(
    query: string,
    countryCode: string | null,
    candidates: Location[],
    fetchedAt: Date,
    expiresAt: Date,
  ): Promise<void> {
    const key = { query, countryCode: countryKey(countryCode) };
    return this.storage('save the location search', () =>
      this.prisma.$transaction(async (tx) => {
        // The search row first: its upsert locks the key, so concurrent saves of
        // the same search replace the results one after the other.
        await tx.locationSearch.upsert({
          where: { query_countryCode: key },
          create: { ...key, fetchedAt, expiresAt },
          update: { fetchedAt, expiresAt },
        });
        // A fixed (lexicographic) ID order keeps lock order stable between searches
        // that share locations, so concurrent saves cannot deadlock.
        for (const location of [...candidates].sort(compareById)) {
          const { id, ...fields } = location;
          await tx.location.upsert({ where: { id }, create: location, update: fields });
        }
        await tx.locationSearchResult.deleteMany({ where: key });
        if (candidates.length > 0) {
          await tx.locationSearchResult.createMany({
            data: candidates.map((location, position) => ({
              ...key,
              position,
              locationId: location.id,
            })),
          });
        }
      }),
    );
  }

  /**
   * Deletes up to `limit` searches that expired at or before `now`; their results
   * cascade. Rows another transaction holds are skipped (SKIP LOCKED), so a purge
   * never waits on or deadlocks with a concurrent save. Locations are kept: stored
   * IDs stay resolvable after the searches that found them expire.
   * Returns the number of searches deleted.
   */
  purgeExpiredSearches(now: Date, limit = PURGE_BATCH_SIZE): Promise<number> {
    return this.storage(
      'purge expired location searches',
      () =>
        this.prisma.$executeRaw`
        DELETE FROM location_searches
        WHERE (query, country_code) IN (
          SELECT query, country_code FROM location_searches
          WHERE expires_at <= ${now}
          ORDER BY expires_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )`,
    );
  }

  /**
   * Runs a database operation and reports an unreachable or failing database as
   * StorageUnavailableError. Anything else, such as a constraint violation from a
   * schema mismatch or a programming error, is rethrown unchanged.
   */
  private async storage<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!isStorageFailure(error)) {
        throw error;
      }
      this.logger.error({ err: error }, `Could not ${operation}`);
      throw new StorageUnavailableError(`Could not ${operation}.`, { cause: error });
    }
  }
}

/** '' stands for "no country filter" in the cache key (see prisma/schema.prisma). */
function countryKey(countryCode: string | null): string {
  return countryCode ?? '';
}

function compareById(a: Location, b: Location): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function toLocation(row: LocationRow): Location {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    region: row.region,
    latitude: row.latitude,
    longitude: row.longitude,
    timezone: row.timezone,
  };
}
