import { GraphQLError, Kind, parse, type VariableDefinitionNode } from 'graphql';
import { formatGraphQLError } from '../../../src/activity-forecast/activity-forecast-error.mapper';

/** Benign marker standing in for a submitted value; no formatted message may contain it. */
const SENTINEL = 'ARC59_SENTINEL_VALUE';

/** The `$input` definition of a parsed operation, as graphql-js attaches it to a coercion error. */
function inputVariable(): VariableDefinitionNode {
  const [operation] = parse(
    'query Forecast($input: ForecastInput!) { activityForecast(input: $input) { __typename } }',
  ).definitions;
  const variable =
    operation.kind === Kind.OPERATION_DEFINITION ? operation.variableDefinitions?.[0] : undefined;
  if (variable === undefined) {
    throw new Error('The test operation declares $input.');
  }
  return variable;
}

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

  it.each([
    `Variable "$input" got invalid value { city: "${SENTINEL}" } at "input.city"; String cannot represent a non string value`,
    'Variable "$input" of required type "ForecastInput!" was not provided.',
    'Variable "$input" of non-null type "ForecastInput!" must not be null.',
  ])('replaces the message of a variable coercion error: %s', (message) => {
    const error = new GraphQLError(message, {
      nodes: [inputVariable()],
      extensions: { code: 'BAD_USER_INPUT' },
    });
    const formatted = {
      message,
      locations: [{ line: 1, column: 16 }],
      extensions: { code: 'BAD_USER_INPUT' },
    };

    const result = formatGraphQLError(formatted, error);

    expect(result).toStrictEqual({
      message: 'Variable "$input" is missing or does not match type "ForecastInput!".',
      locations: [{ line: 1, column: 16 }],
      extensions: { code: 'BAD_USER_INPUT' },
    });
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  it('keeps a domain BAD_USER_INPUT error, field included, untouched', () => {
    const error = new GraphQLError('city must not contain control characters.', {
      path: ['activityForecast'],
      extensions: { code: 'BAD_USER_INPUT', field: 'city' },
    });
    const formatted = {
      message: error.message,
      path: ['activityForecast'],
      extensions: { code: 'BAD_USER_INPUT', field: 'city' },
    };

    expect(formatGraphQLError(formatted, error)).toBe(formatted);
  });

  it('keeps a BAD_USER_INPUT error whose node is not a variable definition', () => {
    const operation = parse('{ __typename }').definitions[0];
    const error = new GraphQLError('Bad input.', { nodes: [operation] });
    const formatted = { message: 'Bad input.', extensions: { code: 'BAD_USER_INPUT' } };

    expect(operation.kind).toBe(Kind.OPERATION_DEFINITION);
    expect(formatGraphQLError(formatted, error)).toBe(formatted);
  });
});
