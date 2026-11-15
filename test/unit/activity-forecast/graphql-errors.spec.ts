import { GraphQLError } from 'graphql';
import { ForecastStorageUnavailableError } from '../../../src/forecasts/forecast.errors';
import {
  GeocodingUnavailableError,
  InvalidLocationInputError,
  StorageUnavailableError,
} from '../../../src/locations/location.errors';
import {
  DomainErrorFilter,
  formatGraphQLError,
} from '../../../src/activity-forecast/graphql-errors';

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

describe('formatGraphQLError', () => {
  it('passes an error with a documented code through untouched', () => {
    const formatted = {
      message: 'Geocoding is unavailable.',
      path: ['locations'],
      extensions: { code: 'GEOCODING_UNAVAILABLE' },
    };

    expect(formatGraphQLError(formatted)).toBe(formatted);
  });

  it('masks an internal error and drops everything but its code', () => {
    const formatted = {
      message: 'connect ECONNREFUSED 127.0.0.1:5432',
      locations: [{ line: 2, column: 3 }],
      path: ['activityForecast'],
      extensions: { code: 'INTERNAL_SERVER_ERROR', stacktrace: ['Error: connect ECONNREFUSED'] },
    };

    expect(formatGraphQLError(formatted)).toStrictEqual({
      message: 'Internal server error.',
      locations: [{ line: 2, column: 3 }],
      path: ['activityForecast'],
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  });

  it.each(['GRAPHQL_VALIDATION_FAILED', 'GRAPHQL_PARSE_FAILED', 'PERSISTED_QUERY_NOT_FOUND'])(
    'passes Apollo request error %s through',
    (code) => {
      const formatted = { message: 'Cannot query field "x".', extensions: { code } };

      expect(formatGraphQLError(formatted)).toBe(formatted);
    },
  );

  it('masks an error that carries a code of its own', () => {
    expect(
      formatGraphQLError({ message: 'SELECT * FROM secret', extensions: { code: 'P2002' } }),
    ).toStrictEqual({
      message: 'Internal server error.',
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  });

  it('masks an error that has no code at all', () => {
    expect(formatGraphQLError({ message: 'odd' })).toStrictEqual({
      message: 'Internal server error.',
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  });
});
