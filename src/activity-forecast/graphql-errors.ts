import { Catch, type ExceptionFilter } from '@nestjs/common';
import { GraphQLError, type GraphQLFormattedError } from 'graphql';
import { ForecastStorageUnavailableError } from '../forecasts/forecast.errors';
import { InvalidLocationInputError, LocationError } from '../locations/location.errors';

/**
 * Maps the domain errors the Technical Design assigns a GraphQL code to a
 * GraphQLError with that `extensions.code`: BAD_USER_INPUT (with the input field
 * at fault), GEOCODING_UNAVAILABLE and STORAGE_UNAVAILABLE. Their messages are
 * written for clients and carry no provider or database text.
 *
 * As a filter it also keeps these expected outcomes out of Nest's exception log;
 * any other error still reaches that log and is then masked by `formatGraphQLError`.
 */
@Catch(LocationError, ForecastStorageUnavailableError)
export class DomainErrorFilter implements ExceptionFilter<
  LocationError | ForecastStorageUnavailableError
> {
  catch(error: LocationError | ForecastStorageUnavailableError): GraphQLError {
    const extensions: Record<string, unknown> =
      error instanceof InvalidLocationInputError
        ? { code: error.code, field: error.field }
        : { code: error.code };
    return new GraphQLError(error.message, { extensions });
  }
}

const INTERNAL_ERROR = 'INTERNAL_SERVER_ERROR';

/**
 * Apollo `formatError` hook. Errors with a code — the ones above and Apollo's own
 * request errors, such as GRAPHQL_VALIDATION_FAILED — pass through. An error
 * without one — a bug or an unexpected infrastructure failure, which Nest has
 * already logged with its stack — is returned as a generic INTERNAL_SERVER_ERROR,
 * so stack traces, SQL and provider text never reach a client (SPEC-04).
 */
export function formatGraphQLError(formatted: GraphQLFormattedError): GraphQLFormattedError {
  const code = formatted.extensions?.code;
  if (code !== undefined && code !== INTERNAL_ERROR) {
    return formatted;
  }
  return {
    message: 'Internal server error.',
    ...(formatted.locations === undefined ? {} : { locations: formatted.locations }),
    ...(formatted.path === undefined ? {} : { path: formatted.path }),
    extensions: { code: INTERNAL_ERROR },
  };
}
