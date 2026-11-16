import { BREAK, GraphQLError, Kind, parse, visit, type ASTNode } from 'graphql';
import { formatGraphQLError } from '../../../src/activity-forecast/activity-forecast-error.mapper';

/** Benign marker standing in for a submitted value; no formatted message may contain it. */
const SENTINEL = 'ARC59_SENTINEL_VALUE';

/** The first node of a kind in a parsed query, as graphql-js attaches it to an error. */
function firstNode(query: string, kind: Kind): ASTNode {
  let found: ASTNode | undefined;
  visit(parse(query), {
    enter(node) {
      if (node.kind === kind) {
        found = node;
        return BREAK;
      }
      return undefined;
    },
  });
  if (found === undefined) {
    throw new Error(`The test query has no ${kind} node.`);
  }
  return found;
}

const FORECAST_OPERATION =
  'query Forecast($input: ForecastInput!) { activityForecast(input: $input) { __typename } }';
const LITERAL_OPERATION = `{ locations(city: "${SENTINEL}") { id } }`;

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

  it.each(['GRAPHQL_VALIDATION_FAILED', 'PERSISTED_QUERY_NOT_FOUND'])(
    'passes Apollo request error %s through',
    (code) => {
      const formatted = { message: 'Cannot query field "x".', extensions: { code } };

      expect(formatGraphQLError(formatted)).toBe(formatted);
    },
  );

  it('keeps the message of a validation error about a name', () => {
    const error = new GraphQLError('Cannot query field "x" on type "Query".', {
      nodes: [firstNode('{ x }', Kind.FIELD)],
    });
    const formatted = { message: error.message, extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } };

    expect(formatGraphQLError(formatted, error)).toBe(formatted);
  });

  it.each([
    [Kind.STRING, `String cannot represent a non string value: "${SENTINEL}"`],
    [Kind.OBJECT_FIELD, `Field "${SENTINEL}" is not defined by type "ForecastInput".`],
  ])('replaces the message of a validation error on an input literal (%s)', (kind, message) => {
    const query =
      kind === Kind.STRING
        ? LITERAL_OPERATION
        : `{ activityForecast(input: { ${SENTINEL}: 1 }) { __typename } }`;
    const error = new GraphQLError(message, { nodes: [firstNode(query, kind)] });
    const formatted = {
      message,
      locations: [{ line: 1, column: 19 }],
      extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
    };

    const result = formatGraphQLError(formatted, error);

    expect(result).toStrictEqual({
      message: 'An input value in the query does not match its expected type.',
      locations: [{ line: 1, column: 19 }],
      extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
    });
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  it('replaces the message of a parse error and keeps its location', () => {
    const message = `Syntax Error: Expected Name, found String "${SENTINEL}".`;
    const formatted = {
      message,
      locations: [{ line: 1, column: 7 }],
      extensions: { code: 'GRAPHQL_PARSE_FAILED' },
    };

    expect(formatGraphQLError(formatted, new GraphQLError(message))).toStrictEqual({
      message: 'The query is not valid GraphQL syntax.',
      locations: [{ line: 1, column: 7 }],
      extensions: { code: 'GRAPHQL_PARSE_FAILED' },
    });
  });

  it('replaces the message of an operation resolution error', () => {
    const message = `Unknown operation named "${SENTINEL}".`;
    const formatted = { message, extensions: { code: 'OPERATION_RESOLUTION_FAILURE' } };

    expect(formatGraphQLError(formatted, new GraphQLError(message))).toStrictEqual({
      message: 'Set operationName to the name of one operation in the query.',
      extensions: { code: 'OPERATION_RESOLUTION_FAILURE' },
    });
  });

  it("reports graphql-js's too-many-variable-errors entry as BAD_USER_INPUT", () => {
    const message = 'Too many errors processing variables, error limit reached. Execution aborted.';
    const formatted = { message, extensions: { code: 'INTERNAL_SERVER_ERROR' } };

    expect(formatGraphQLError(formatted, new GraphQLError(message))).toStrictEqual({
      message: 'Too many invalid variables; the rest were not checked.',
      extensions: { code: 'BAD_USER_INPUT' },
    });
  });

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
      nodes: [firstNode(FORECAST_OPERATION, Kind.VARIABLE_DEFINITION)],
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
