import { GraphQLError } from 'graphql';
import { ForecastStorageUnavailableError } from '../../../src/forecast/forecast.errors';
import {
  GeocodingUnavailableError,
  InvalidLocationInputError,
  StorageUnavailableError,
} from '../../../src/location/location.errors';
import { DomainErrorFilter } from '../../../src/activity-forecast/activity-forecast.filter';

describe('DomainErrorFilter', () => {
  const filter = new DomainErrorFilter();

  it.each([
    [new GeocodingUnavailableError('TIMEOUT', 'Geocoding timed out.'), 'GEOCODING_UNAVAILABLE'],
    [new StorageUnavailableError('Could not read a location.'), 'STORAGE_UNAVAILABLE'],
    [new ForecastStorageUnavailableError('Could not save a snapshot.'), 'STORAGE_UNAVAILABLE'],
  ])('keeps the message of %s and sets %s', (failure, code) => {
    const error = filter.catch(failure);

    expect(error).toBeInstanceOf(GraphQLError);
    expect(error.message).toBe(failure.message);
    expect(error.extensions).toEqual({ code });
  });

  it.each([['city' as const], ['countryCode' as const], ['locationId' as const], [null]])(
    'names the field at fault (%s) in BAD_USER_INPUT',
    (field) => {
      const error = filter.catch(new InvalidLocationInputError('Invalid.', field));

      expect(error.extensions).toEqual({ code: 'BAD_USER_INPUT', field });
    },
  );
});
