import { unwrapResolverError } from '@apollo/server/errors';
import { Logger } from '@nestjs/common';
import { GraphQLError, type GraphQLFormattedError } from 'graphql';
import { ForecastStorageUnavailableError } from '../forecasts/forecast.errors';
import { InvalidLocationInputError, LocationError } from '../locations/location.errors';

/**
 * Maps the domain errors the Technical Design assigns a GraphQL code to a
 * GraphQLError with that `extensions.code`: BAD_USER_INPUT (with the input field
 * at fault), GEOCODING_UNAVAILABLE and STORAGE_UNAVAILABLE. Their messages are
 * written for clients and carry no provider or database text. Anything else is
 * returned unchanged and masked by `formatGraphQLError`.
 */
export function toGraphQLError(error: unknown): unknown {
  if (error instanceof InvalidLocationInputError) {
    return new GraphQLError(error.message, {
      extensions: { code: error.code, field: error.field },
    });
  }
  if (error instanceof LocationError || error instanceof ForecastStorageUnavailableError) {
    return new GraphQLError(error.message, { extensions: { code: error.code } });
  }
  return error;
}

const logger = new Logger('GraphQL');

const INTERNAL_ERROR = 'INTERNAL_SERVER_ERROR';

/**
 * Apollo `formatError` hook. Errors with a code — the ones above and Apollo's own
 * request errors, such as GRAPHQL_VALIDATION_FAILED — pass through. An error
 * without one — a bug or an unexpected infrastructure failure — is logged in full
 * and returned as a generic INTERNAL_SERVER_ERROR, so stack traces, SQL and
 * provider text never reach a client (SPEC-04).
 */
export function formatGraphQLError(
  formatted: GraphQLFormattedError,
  error: unknown,
): GraphQLFormattedError {
  const code = formatted.extensions?.code;
  if (code !== undefined && code !== INTERNAL_ERROR) {
    return formatted;
  }
  const cause = unwrapResolverError(error);
  logger.error(
    cause instanceof Error ? cause.message : formatted.message,
    cause instanceof Error ? cause.stack : undefined,
  );
  return {
    message: 'Internal server error.',
    locations: formatted.locations,
    path: formatted.path,
    extensions: { code: INTERNAL_ERROR },
  };
}
