import { Catch, type ExceptionFilter } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { ForecastStorageUnavailableError } from '../forecast/forecast.errors';
import { InvalidLocationInputError, LocationError } from '../location/location.errors';

/**
 * Maps the domain errors the Technical Design assigns a GraphQL code to a
 * GraphQLError with that `extensions.code`: BAD_USER_INPUT (with the input field
 * at fault), GEOCODING_UNAVAILABLE and STORAGE_UNAVAILABLE. Their messages are
 * written for clients: at most a provider status or timeout, never a provider
 * payload or database text.
 *
 * As a filter it also keeps these expected outcomes out of Nest's exception log;
 * any other error still reaches that log and is then masked by `formatGraphQLError`
 * (activity-forecast-error.mapper.ts).
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
