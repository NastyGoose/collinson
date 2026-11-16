import { ApolloServerErrorCode, ApolloServerValidationErrorCode } from '@apollo/server/errors';
import {
  GraphQLError,
  Kind,
  print,
  type ASTNode,
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
 * Nodes of an input value written in the query. A validation error on one of
 * them (ValuesOfCorrectTypeRule) prints the value back in its message. An
 * undeclared field inside an input object is reported on its OBJECT_FIELD node
 * and names only the field, so like other errors about names it keeps its text.
 */
const INPUT_LITERAL_KINDS: ReadonlySet<Kind> = new Set([
  Kind.STRING,
  Kind.INT,
  Kind.FLOAT,
  Kind.BOOLEAN,
  Kind.NULL,
  Kind.ENUM,
  Kind.LIST,
  Kind.OBJECT,
]);

/**
 * graphql-js stops coercing variables after 50 errors and adds this one, with no
 * node and no code. Its text is the only thing that identifies it.
 */
const TOO_MANY_VARIABLE_ERRORS =
  'Too many errors processing variables, error limit reached. Execution aborted.';

/** The client-facing replacement for an error whose original message quotes the request. */
interface FixedError {
  code: string;
  message: string;
}

/**
 * Apollo `formatError` hook (SPEC-04, ARC-59).
 *
 * Request errors whose graphql-js message quotes what the client sent get a
 * fixed message and keep their code and locations:
 * - a variable coercion error (BAD_USER_INPUT) names only the variable and its
 *   declared type. It has no `field`: graphql-js keeps the path inside the
 *   variable only in the message text, never as structured data;
 * - a parse error (GRAPHQL_PARSE_FAILED), which quotes the offending token;
 * - a validation error on an input literal (GRAPHQL_VALIDATION_FAILED), which
 *   prints the literal. Validation errors about names, such as an unknown
 *   field, keep their message: a GraphQL name cannot carry arbitrary text;
 * - an operation resolution error, which quotes `operationName`;
 * - graphql-js's "too many variable errors" entry, which has no code of its own
 *   and becomes BAD_USER_INPUT like the errors before it.
 *
 * Other errors with a public code — the documented ones and Apollo's own
 * request errors — pass through. Any other error — a bug or an unexpected
 * infrastructure failure, which Nest has already logged with its stack, even
 * one carrying a code of its own — is returned as a generic
 * INTERNAL_SERVER_ERROR, so stack traces, SQL and provider text never reach a
 * client.
 */
export function formatGraphQLError(
  formatted: GraphQLFormattedError,
  error?: unknown,
): GraphQLFormattedError {
  const fixed = fixedErrorFor(formatted, error);
  if (fixed !== null) {
    return {
      message: fixed.message,
      ...locationsOf(formatted),
      extensions: { code: fixed.code },
    };
  }
  if (PUBLIC_CODES.has(formatted.extensions?.code)) {
    return formatted;
  }
  return {
    message: 'Internal server error.',
    ...locationsOf(formatted),
    ...(formatted.path === undefined ? {} : { path: formatted.path }),
    extensions: { code: INTERNAL_ERROR },
  };
}

function fixedErrorFor(formatted: GraphQLFormattedError, error: unknown): FixedError | null {
  // Resolver errors, such as the location input checks, always have a path and
  // keep their own messages.
  if (formatted.path !== undefined) {
    return null;
  }
  const nodes = error instanceof GraphQLError ? error.nodes : undefined;
  const node = nodes?.length === 1 ? nodes[0] : undefined;
  const code = formatted.extensions?.code;
  switch (code) {
    case BAD_USER_INPUT: {
      const variable = variableDefinition(node);
      return variable === null
        ? null
        : {
            code,
            message: `Variable "$${variable.variable.name.value}" is missing or does not match type "${print(variable.type)}".`,
          };
    }
    case ApolloServerErrorCode.GRAPHQL_PARSE_FAILED:
      return { code, message: 'The query is not valid GraphQL syntax.' };
    case ApolloServerErrorCode.GRAPHQL_VALIDATION_FAILED:
      return node !== undefined && INPUT_LITERAL_KINDS.has(node.kind)
        ? { code, message: 'An input value in the query does not match its expected type.' }
        : null;
    case ApolloServerErrorCode.OPERATION_RESOLUTION_FAILURE:
      return {
        code,
        message:
          "Set operationName to one of the query's named operations, or omit it when the query has a single operation.",
      };
    case INTERNAL_ERROR:
      return nodes === undefined && formatted.message === TOO_MANY_VARIABLE_ERRORS
        ? {
            code: BAD_USER_INPUT,
            message: 'Too many invalid variables; the rest were not checked.',
          }
        : null;
    default:
      return null;
  }
}

/**
 * A request-level coercion error has a single variable-definition node:
 * graphql-js builds every "invalid value", "not provided" and "must not be null"
 * variable error this way, and Apollo uses the same structure to classify them
 * as BAD_USER_INPUT.
 */
function variableDefinition(node: ASTNode | undefined): VariableDefinitionNode | null {
  return node?.kind === Kind.VARIABLE_DEFINITION ? node : null;
}

function locationsOf(formatted: GraphQLFormattedError): Pick<GraphQLFormattedError, 'locations'> {
  return formatted.locations === undefined ? {} : { locations: formatted.locations };
}
