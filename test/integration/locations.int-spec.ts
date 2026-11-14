import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { Clock } from '../../src/clock/clock';
import { ClockModule } from '../../src/clock/clock.module';
import { validateEnv } from '../../src/config/env';
import { HTTP_FETCH } from '../../src/http/http-fetch';
import {
  GeocodingUnavailableError,
  InvalidLocationInputError,
} from '../../src/locations/location.errors';
import { LocationsModule } from '../../src/locations/locations.module';
import {
  LocationsService,
  SEARCH_EMPTY_TTL_MS,
  SEARCH_MATCH_TTL_MS,
} from '../../src/locations/locations.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  BERLIN_DE,
  NO_MATCH,
  resultsBody,
  SAO_PAULO_BR,
  SPRINGFIELD_IL,
  SPRINGFIELD_MA,
  SPRINGFIELD_MO,
} from '../fixtures/open-meteo-geocoding';
import { FixedClock } from '../support/fixed-clock';
import { fixtureFetch, jsonResponse } from '../support/fixture-fetch';

const START = '2026-11-14T12:00:00.000Z';
const MINUTE_MS = 60 * 1000;

interface SearchRow {
  query: string;
  country_code: string;
  fetched_at: Date;
  expires_at: Date;
  location_ids: string[];
}

/** Routes each request by its `name` (lowercased) and `countryCode` parameters. */
function providerFixtures(routes: Record<string, unknown>) {
  return fixtureFetch((url) => {
    const name = url.searchParams.get('name')?.toLowerCase() ?? '';
    const country = url.searchParams.get('countryCode');
    const body = routes[country === null ? name : `${name}|${country}`];
    if (body === undefined) {
      throw new Error(`no fixture for ${url.search}`);
    }
    return jsonResponse(body);
  });
}

const PROVIDER = {
  'são paulo': resultsBody(SAO_PAULO_BR),
  springfield: resultsBody(SPRINGFIELD_MO, SPRINGFIELD_IL, SPRINGFIELD_MA),
  berlin: resultsBody(BERLIN_DE, SPRINGFIELD_IL),
  'berlin|DE': resultsBody(BERLIN_DE),
  zzqxqxq: NO_MATCH,
};

describe('LocationsService with PostgreSQL', () => {
  const clock = new FixedClock(START);
  let fetch = providerFixtures(PROVIDER);
  let moduleRef: TestingModule;
  let service: LocationsService;
  let prisma: PrismaService;

  async function createModule(): Promise<TestingModule> {
    const testingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        PrismaModule,
        ClockModule,
        LocationsModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .overrideProvider(HTTP_FETCH)
      // Delegate, so each test can swap the fixture behind the same provider.
      .useValue((...args: Parameters<typeof fetch>) => fetch(...args))
      .compile();
    return testingModule.init();
  }

  async function searchRows(): Promise<SearchRow[]> {
    return prisma.$queryRaw<SearchRow[]>`
      SELECT s.query, s.country_code, s.fetched_at, s.expires_at,
             COALESCE(array_agg(r.location_id ORDER BY r.position)
                      FILTER (WHERE r.location_id IS NOT NULL), '{}') AS location_ids
      FROM location_searches s
      LEFT JOIN location_search_results r USING (query, country_code)
      GROUP BY s.query, s.country_code, s.fetched_at, s.expires_at
      ORDER BY s.query, s.country_code`;
  }

  async function locationIds(): Promise<string[]> {
    const rows = await prisma.location.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    return rows.map((row) => row.id);
  }

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    moduleRef = await createModule();
    service = moduleRef.get(LocationsService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef.close();
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE location_search_results, location_searches, locations`;
    clock.set(START);
    fetch = providerFixtures(PROVIDER);
  });

  describe('selection outcomes', () => {
    it('resolves a unique city and persists its stable ID', async () => {
      const resolution = await service.resolve({ city: ' São Paulo ' });

      expect(resolution).toEqual({
        kind: 'resolved',
        location: {
          id: '3448439',
          name: 'São Paulo',
          country: 'Brazil',
          region: 'São Paulo',
          latitude: -23.5475,
          longitude: -46.63611,
          timezone: 'America/Sao_Paulo',
        },
      });
      await expect(prisma.location.findUnique({ where: { id: '3448439' } })).resolves.toMatchObject(
        { name: 'São Paulo', timezone: 'America/Sao_Paulo' },
      );
    });

    it('returns ambiguous Springfield as distinct IDs in provider order, each stored separately', async () => {
      const resolution = await service.resolve({ city: 'Springfield' });

      expect(resolution.kind).toBe('ambiguous');
      const ids =
        resolution.kind === 'ambiguous' ? resolution.candidates.map((location) => location.id) : [];
      expect(ids).toEqual(['4409896', '4250542', '4951788']);
      expect(await locationIds()).toEqual(['4250542', '4409896', '4951788']);
      expect((await searchRows())[0].location_ids).toEqual(['4409896', '4250542', '4951788']);
    });

    it('returns a typed not-found for a genuine no-match', async () => {
      await expect(service.resolve({ city: 'Zzqxqxq' })).resolves.toEqual({
        kind: 'not_found',
        message: 'No location matches "Zzqxqxq".',
      });
    });

    it('applies the country filter to the provider request and the cache key', async () => {
      const unfiltered = await service.search('Berlin');
      const filtered = await service.resolve({ city: 'berlin', countryCode: 'de' });

      expect(unfiltered.map((location) => location.id)).toEqual(['2950159', '4250542']);
      expect(filtered).toMatchObject({ kind: 'resolved', location: { id: '2950159' } });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(
        (await searchRows()).map(({ query, country_code, location_ids }) => [
          query,
          country_code,
          location_ids,
        ]),
      ).toEqual([
        ['berlin', '', ['2950159', '4250542']],
        ['berlin', 'DE', ['2950159']],
      ]);
    });

    it('rejects invalid input before touching the provider or the database', async () => {
      await expect(service.resolve({ city: '   ' })).rejects.toBeInstanceOf(
        InvalidLocationInputError,
      );
      await expect(
        service.resolve({ city: 'Berlin', locationId: '2950159' }),
      ).rejects.toBeInstanceOf(InvalidLocationInputError);
      await expect(service.search('Berlin', 'DEU')).rejects.toBeInstanceOf(
        InvalidLocationInputError,
      );

      expect(fetch).not.toHaveBeenCalled();
      expect(await searchRows()).toEqual([]);
    });
  });

  describe('stored IDs', () => {
    it('resolves a stored ID without geocoding, also during an outage and after a restart', async () => {
      await service.resolve({ city: 'Springfield' });
      fetch = fixtureFetch(() => jsonResponse({}, 503));

      await expect(service.resolve({ locationId: '4250542' })).resolves.toMatchObject({
        kind: 'resolved',
        location: { id: '4250542', region: 'Illinois', timezone: 'America/Chicago' },
      });

      const restarted = await createModule();
      try {
        await expect(
          restarted.get(LocationsService).resolve({ locationId: '4951788' }),
        ).resolves.toMatchObject({ kind: 'resolved', location: { region: 'Massachusetts' } });
      } finally {
        await restarted.close();
      }
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each(['999999999', 'not-an-id', '0', '-4250542'])(
      'returns not-found for the unknown ID %j without geocoding',
      async (locationId) => {
        await expect(service.resolve({ locationId })).resolves.toEqual({
          kind: 'not_found',
          message: `No stored location has ID "${locationId}".`,
        });
        expect(fetch).not.toHaveBeenCalled();
      },
    );
  });

  describe('search cache', () => {
    it('reuses a match for 24 hours under the normalized key', async () => {
      await service.search('Springfield');
      clock.advance(SEARCH_MATCH_TTL_MS - MINUTE_MS);

      const cached = await service.search('  SPRINGFIELD ');

      expect(cached.map((location) => location.id)).toEqual(['4409896', '4250542', '4951788']);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [row] = await searchRows();
      expect(row.query).toBe('springfield');
      expect(row.expires_at.getTime() - row.fetched_at.getTime()).toBe(SEARCH_MATCH_TTL_MS);

      clock.advance(MINUTE_MS);
      await service.search('Springfield');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('reuses a genuine empty result for one hour', async () => {
      await expect(service.search('Zzqxqxq')).resolves.toEqual([]);
      const [row] = await searchRows();
      expect(row.location_ids).toEqual([]);
      expect(row.expires_at.getTime() - row.fetched_at.getTime()).toBe(SEARCH_EMPTY_TTL_MS);

      clock.advance(SEARCH_EMPTY_TTL_MS - MINUTE_MS);
      await service.search('zzqxqxq');
      expect(fetch).toHaveBeenCalledTimes(1);

      clock.advance(MINUTE_MS);
      await service.search('Zzqxqxq');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('replaces the ordered results and refreshes stored locations when an expired search is fetched again', async () => {
      await service.search('Springfield');
      clock.advance(SEARCH_MATCH_TTL_MS);
      fetch = providerFixtures({
        springfield: resultsBody({ ...SPRINGFIELD_MA, name: 'Springfield City' }, SPRINGFIELD_MO),
      });

      const refreshed = await service.search('Springfield');

      expect(refreshed.map((location) => location.id)).toEqual(['4951788', '4409896']);
      const [row] = await searchRows();
      expect(row.location_ids).toEqual(['4951788', '4409896']);
      expect(row.fetched_at.toISOString()).toBe(clock.now().toISOString());
      // Locations stay stored for ID selection even when a later search omits them.
      expect(await locationIds()).toEqual(['4250542', '4409896', '4951788']);
      await expect(service.resolve({ locationId: '4951788' })).resolves.toMatchObject({
        location: { name: 'Springfield City' },
      });
    });

    it('stores one consistent entry when the same new search runs concurrently', async () => {
      const results = await Promise.all([
        service.search('Springfield'),
        service.search('springfield'),
        service.search('SPRINGFIELD'),
      ]);

      for (const candidates of results) {
        expect(candidates).toHaveLength(3);
      }
      const rows = await searchRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].location_ids).toEqual(['4409896', '4250542', '4951788']);
    });
  });

  describe('provider failures', () => {
    it('never caches a provider error and leaves an expired empty result untouched', async () => {
      await service.search('Zzqxqxq');
      const [before] = await searchRows();
      clock.advance(2 * SEARCH_EMPTY_TTL_MS);
      fetch = fixtureFetch(() => jsonResponse({}, 503));

      await expect(service.search('Zzqxqxq')).rejects.toMatchObject({
        code: 'GEOCODING_UNAVAILABLE',
        kind: 'UPSTREAM_FAILURE',
      });

      expect(await searchRows()).toEqual([before]);
    });

    it('caches nothing when a never-seen search fails', async () => {
      fetch = fixtureFetch(() => jsonResponse({ error: true, reason: 'Internal error' }, 500));

      await expect(service.resolve({ city: 'Springfield' })).rejects.toBeInstanceOf(
        GeocodingUnavailableError,
      );

      expect(await searchRows()).toEqual([]);
      expect(await locationIds()).toEqual([]);
    });

    it('treats a wholly unusable response as a failure, not an empty result', async () => {
      fetch = providerFixtures({
        springfield: resultsBody(
          { ...SPRINGFIELD_MO, timezone: undefined },
          { ...SPRINGFIELD_IL, latitude: 'n/a' },
        ),
      });

      await expect(service.search('Springfield')).rejects.toMatchObject({
        kind: 'UNUSABLE_RESULTS',
      });
      expect(await searchRows()).toEqual([]);

      fetch = providerFixtures(PROVIDER);
      await expect(service.search('Springfield')).resolves.toHaveLength(3);
    });
  });
});
