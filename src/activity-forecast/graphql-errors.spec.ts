import { Logger } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { ForecastStorageUnavailableError } from '../forecasts/forecast.errors';
import { InvalidLocationInputError } from '../locations/location.errors';
import { formatGraphQLError, toGraphQLError } from './graphql-errors';

describe('toGraphQLError', () => {
  it('keeps the client-facing message and sets the documented code', () => {
    const error = toGraphQLError(new ForecastStorageUnavailableError('Could not save.'));

    expect(error).toBeInstanceOf(GraphQLError);
    expect(error).toMatchObject({
      message: 'Could not save.',
      extensions: { code: 'STORAGE_UNAVAILABLE' },
    });
  });

  it('carries a null field for a selector-level BAD_USER_INPUT', () => {
    const error = toGraphQLError(new InvalidLocationInputError('Provide exactly one.', null));

    expect(error).toMatchObject({ extensions: { code: 'BAD_USER_INPUT', field: null } });
  });

  it('returns any other error unchanged', () => {
    const bug = new TypeError('boom');

    expect(toGraphQLError(bug)).toBe(bug);
  });
});

describe('formatGraphQLError', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes an error with a documented code through untouched', () => {
    const formatted = {
      message: 'Geocoding is unavailable.',
      path: ['locations'],
      extensions: { code: 'GEOCODING_UNAVAILABLE' },
    };

    expect(formatGraphQLError(formatted, new GraphQLError(formatted.message))).toBe(formatted);
  });

  it('masks an internal error and drops everything but its code', () => {
    const cause = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    const formatted = {
      message: cause.message,
      path: ['activityForecast'],
      extensions: { code: 'INTERNAL_SERVER_ERROR', stacktrace: ['Error: connect ECONNREFUSED'] },
    };

    expect(
      formatGraphQLError(formatted, new GraphQLError(cause.message, { originalError: cause })),
    ).toEqual({
      message: 'Internal server error.',
      path: ['activityForecast'],
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
    expect(Logger.prototype.error).toHaveBeenCalledWith(cause.message, cause.stack);
  });

  it('masks an error that has no code at all', () => {
    expect(formatGraphQLError({ message: 'odd' }, new Error('odd'))).toEqual({
      message: 'Internal server error.',
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  });
});
