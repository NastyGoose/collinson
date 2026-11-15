import { formatGraphQLError } from '../../../src/activity-forecast/activity-forecast-error.mapper';

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
