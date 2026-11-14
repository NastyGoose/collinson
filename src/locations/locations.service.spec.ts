import { Test } from '@nestjs/testing';
import { FixedClock } from '../../test/support/fixed-clock';
import { Clock } from '../clock/clock';
import type { Location } from './location';
import { GeocodingUnavailableError, StorageUnavailableError } from './location.errors';
import { LocationsRepository } from './locations.repository';
import { LocationsService, SEARCH_EMPTY_TTL_MS, SEARCH_MATCH_TTL_MS } from './locations.service';
import { OpenMeteoGeocodingClient } from './open-meteo-geocoding.client';

const NOW = new Date('2026-11-14T12:00:00.000Z');

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
  const repository: jest.Mocked<
    Pick<LocationsRepository, 'findLocation' | 'findFreshSearch' | 'saveSearch'>
  > = {
    findLocation: jest.fn().mockResolvedValue(null),
    findFreshSearch: jest.fn().mockResolvedValue(null),
    saveSearch: jest.fn().mockResolvedValue(undefined),
  };
  const geocoding: jest.Mocked<Pick<OpenMeteoGeocodingClient, 'search'>> = {
    search: jest.fn(),
  };
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
  it.each([
    ['one candidate resolves', [location('1')], { kind: 'resolved', location: location('1') }],
    [
      'several candidates are ambiguous',
      [location('1'), location('2')],
      { kind: 'ambiguous', candidates: [location('1'), location('2')] },
    ],
    [
      'no candidate is not-found',
      [],
      { kind: 'not_found', message: 'No location matches "Nowhere" in US.' },
    ],
  ])('%s', async (_label, candidates, expected) => {
    const { service, geocoding } = await createService();
    geocoding.search.mockResolvedValue(candidates);

    await expect(service.resolve({ city: ' Nowhere ', countryCode: 'us' })).resolves.toEqual(
      expected,
    );
  });

  it('sends the normalized query and caches under it with the TTL for the outcome', async () => {
    const { service, repository, geocoding } = await createService();
    geocoding.search.mockResolvedValueOnce([location('1')]).mockResolvedValueOnce([]);

    await service.search('  Spring   Field ', 'us');
    await service.search('Nowhere');

    expect(geocoding.search).toHaveBeenNthCalledWith(1, 'spring field', 'US');
    expect(repository.findFreshSearch).toHaveBeenNthCalledWith(1, 'spring field', 'US', NOW);
    expect(repository.saveSearch).toHaveBeenNthCalledWith(
      1,
      'spring field',
      'US',
      [location('1')],
      NOW,
      new Date(NOW.getTime() + SEARCH_MATCH_TTL_MS),
    );
    expect(repository.saveSearch).toHaveBeenNthCalledWith(
      2,
      'nowhere',
      null,
      [],
      NOW,
      new Date(NOW.getTime() + SEARCH_EMPTY_TTL_MS),
    );
  });

  it('serves a fresh cache entry without calling the provider', async () => {
    const { service, repository, geocoding } = await createService();
    repository.findFreshSearch.mockResolvedValue({
      candidates: [location('7')],
      fetchedAt: NOW,
      expiresAt: NOW,
    });

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

  it('names a well-formed unknown ID in the not-found message', async () => {
    const { service } = await createService();

    await expect(service.resolve({ locationId: '999999999' })).resolves.toEqual({
      kind: 'not_found',
      message: 'No stored location has ID "999999999".',
    });
  });

  it.each(['abc', '0', '007', '1.5', '12345678901234567', '9'.repeat(200)])(
    'answers not-found for the non-canonical ID %j without a database read or echo',
    async (locationId) => {
      const { service, repository } = await createService();

      await expect(service.resolve({ locationId })).resolves.toEqual({
        kind: 'not_found',
        message: 'No stored location has the given ID.',
      });
      expect(repository.findLocation).not.toHaveBeenCalled();
    },
  );
});
