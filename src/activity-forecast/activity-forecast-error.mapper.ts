import { ApolloServerErrorCode, ApolloServerValidationErrorCode } from '@apollo/server/errors';
import {
  GraphQLError,
  Kind,
  print,
  type GraphQLFormattedError,
  type VariableDefinitionNode,
} from 'graphql';

const INTERNAL_ERROR = ApolloServerErrorCode.INTERNAL_SERVER_ERROR;
const BAD_USER_INPUT = ApolloServerErrorCode.BAD_USER_INPUT;

/** Codes whose message is written for clients: the documented ones and Apollo's request errors. */
const PUBLIC_CODES: ReadonlySet<unknown> = new Set<string>([
  'BAD_USER_INPUT',
  'GEOCODING_UNAVAILABLE',
  'STORAGE_UNAVAILABLE',
  ...Object.values(ApolloServerErrorCode).filter((code) => code !== INTERNAL_ERROR),
  ...Object.values(ApolloServerValidationErrorCode),
]);

/**
 * Apollo `formatError` hook. Errors with a public code — the ones above and
 * Apollo's own request errors, such as GRAPHQL_VALIDATION_FAILED — pass through,
 * with one exception. The graphql-js message of a variable coercion error quotes
 * the submitted value, so that error keeps BAD_USER_INPUT and its locations but
 * gets a fixed message naming only the variable and its declared type (ARC-59).
 * It has no `field`: graphql-js keeps the path inside the variable only in the
 * message text, never as structured data.
 *
 * Any other error — a bug or an unexpected infrastructure failure, which Nest has
 * already logged with its stack, even one carrying a code of its own — is returned
 * as a generic INTERNAL_SERVER_ERROR, so stack traces, SQL and provider text never
 * reach a client (SPEC-04).
 */
export function formatGraphQLError(
  formatted: GraphQLFormattedError,
  error?: unknown,
): GraphQLFormattedError {
  const code = formatted.extensions?.code;
  const variable = code === BAD_USER_INPUT ? coercedVariable(error) : null;
  if (variable !== null) {
    const name = variable.variable.name.value;
    return {
      message: `Variable "$${name}" is missing or does not match type "${print(variable.type)}".`,
      ...locationsOf(formatted),
      extensions: { code: BAD_USER_INPUT },
    };
  }
  if (PUBLIC_CODES.has(code)) {
    return formatted;
  }
  return {
    message: 'Internal server error.',
    ...locationsOf(formatted),
    ...(formatted.path === undefined ? {} : { path: formatted.path }),
    extensions: { code: INTERNAL_ERROR },
  };
}

/**
 * The variable definition behind a request-level coercion error: a GraphQLError
 * with no path whose only node is a variable definition. graphql-js builds every
 * "invalid value", "not provided" and "must not be null" variable error this way,
 * and Apollo uses the same structure to classify them as BAD_USER_INPUT. Resolver
 * errors, such as the location input checks, always have a path and stay as they are.
 */
function coercedVariable(error: unknown): VariableDefinitionNode | null {
  if (!(error instanceof GraphQLError) || error.path !== undefined) {
    return null;
  }
  const node = error.nodes?.length === 1 ? error.nodes[0] : undefined;
  return node?.kind === Kind.VARIABLE_DEFINITION ? node : null;
}

function locationsOf(formatted: GraphQLFormattedError): Pick<GraphQLFormattedError, 'locations'> {
  return formatted.locations === undefined ? {} : { locations: formatted.locations };
}
