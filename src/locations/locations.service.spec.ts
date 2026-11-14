import { Test } from '@nestjs/testing';
import { FixedClock } from '../../test/support/fixed-clock';
import { Clock } from '../clock/clock';
import type { Location } from './location';
import { GeocodingUnavailableError, StorageUnavailableError } from './location.errors';
import { LocationsRepository } from './locations.repository';
import { LocationsService, SEARCH_EMPTY_TTL_MS, SEARCH_MATCH_TTL_MS } from './locations.service';
import { OpenMeteoGeocodingClient } from './open-meteo-geocoding.client';

const NOW = '2026-11-14T12:00:00.000Z';

function location(id: string): Location {
  return {
    id,
    name: 'Springfield',
    country: 'United States',
    region: null,
    latitude: 39.8,
    longitude: -89.6,
    timezone: 'America/Chicago',
  };
}

async function createService() {
  const repository = {
    findLocation: jest.fn<Promise<Location | null>, [string]>().mockResolvedValue(null),
    findFreshSearch: jest.fn().mockResolvedValue(null),
    saveSearch: jest.fn().mockResolvedValue(undefined),
  };
  const geocoding = { search: jest.fn<Promise<Location[]>, [string, string | null]>() };
  const moduleRef = await Test.createTestingModule({
    providers: [
      LocationsService,
      { provide: LocationsRepository, useValue: repository },
      { provide: OpenMeteoGeocodingClient, useValue: geocoding },
      { provide: Clock, useValue: new FixedClock(NOW) },
    ],
  }).compile();
  return { service: moduleRef.get(LocationsService), repository, geocoding };
}

describe('LocationsService', () => {
  it('maps one, several and no candidates to resolved, ambiguous and not-found', async () => {
    const { service, geocoding } = await createService();
    geocoding.search
      .mockResolvedValueOnce([location('1')])
      .mockResolvedValueOnce([location('1'), location('2')])
      .mockResolvedValueOnce([]);

    await expect(service.resolve({ city: 'A1' })).resolves.toMatchObject({ kind: 'resolved' });
    await expect(service.resolve({ city: 'A2' })).resolves.toMatchObject({
      kind: 'ambiguous',
      candidates: [{ id: '1' }, { id: '2' }],
    });
    await expect(service.resolve({ city: 'A3', countryCode: 'us' })).resolves.toEqual({
      kind: 'not_found',
      message: 'No location matches "A3" in US.',
    });
  });

  it('sends the normalized query and caches under the lowercased key with the TTL for the outcome', async () => {
    const { service, repository, geocoding } = await createService();
    geocoding.search.mockResolvedValueOnce([location('1')]).mockResolvedValueOnce([]);

    await service.search('  Spring   Field ', 'us');
    await service.search('Nowhere');

    expect(geocoding.search).toHaveBeenNthCalledWith(1, 'Spring Field', 'US');
    expect(repository.findFreshSearch).toHaveBeenNthCalledWith(
      1,
      'spring field',
      'US',
      new Date(NOW),
    );
    const fetchedAt = new Date(NOW);
    expect(repository.saveSearch).toHaveBeenNthCalledWith(
      1,
      'spring field',
      'US',
      [location('1')],
      fetchedAt,
      new Date(fetchedAt.getTime() + SEARCH_MATCH_TTL_MS),
    );
    expect(repository.saveSearch).toHaveBeenNthCalledWith(
      2,
      'nowhere',
      null,
      [],
      fetchedAt,
      new Date(fetchedAt.getTime() + SEARCH_EMPTY_TTL_MS),
    );
  });

  it('serves a fresh cache entry without calling the provider', async () => {
    const { service, repository, geocoding } = await createService();
    repository.findFreshSearch.mockResolvedValue({ candidates: [location('7')] });

    await expect(service.search('Springfield')).resolves.toEqual([location('7')]);
    expect(geocoding.search).not.toHaveBeenCalled();
  });

  it('writes nothing when the provider fails', async () => {
    const { service, repository, geocoding } = await createService();
    geocoding.search.mockRejectedValue(new GeocodingUnavailableError('TIMEOUT', 'timed out'));

    await expect(service.resolve({ city: 'Springfield' })).rejects.toMatchObject({
      code: 'GEOCODING_UNAVAILABLE',
    });
    expect(repository.saveSearch).not.toHaveBeenCalled();
  });

  it('does not call the provider when the cache cannot be read', async () => {
    const { service, repository, geocoding } = await createService();
    repository.findFreshSearch.mockRejectedValue(new StorageUnavailableError('down'));

    await expect(service.search('Springfield')).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(geocoding.search).not.toHaveBeenCalled();
  });

  it('fails with STORAGE_UNAVAILABLE when the result cannot be saved', async () => {
    const { service, repository, geocoding } = await createService();
    geocoding.search.mockResolvedValue([location('1')]);
    repository.saveSearch.mockRejectedValue(new StorageUnavailableError('down'));

    await expect(service.resolve({ city: 'Springfield' })).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
  });

  it('resolves a stored ID from the repository only', async () => {
    const { service, repository, geocoding } = await createService();
    repository.findLocation.mockResolvedValue(location('4250542'));

    await expect(service.resolve({ locationId: '4250542' })).resolves.toEqual({
      kind: 'resolved',
      location: location('4250542'),
    });
    expect(geocoding.search).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '007', '1.5', '12345678901234567'])(
    'answers not-found for the non-canonical ID %j without a database read',
    async (locationId) => {
      const { service, repository } = await createService();

      await expect(service.resolve({ locationId })).resolves.toMatchObject({ kind: 'not_found' });
      expect(repository.findLocation).not.toHaveBeenCalled();
    },
  );
});
