import type { PinoLogger } from 'nestjs-pino';
import { UpstreamRequestError } from '../http/http.errors';
import { JsonRequestService } from '../http/json-request.service';
import { OPEN_METEO_TIMEOUT_MS } from './forecast.constants';
import { SourceRefreshError, type SourceFailureCode } from './forecast.errors';
import type { ForecastLocation, ForecastSourceSpec, NormalizedForecast } from './forecast.types';
import { forecastUrl, parseForecastResponse } from './open-meteo-forecast.mapper';

/**
 * Shared Open-Meteo forecast adapter: one bounded request (JsonRequestService),
 * then validation into a NormalizedForecast. Subclasses supply the source spec. Failures surface as
 * SourceRefreshError; nothing here reads or writes storage.
 */
export abstract class OpenMeteoForecastClient {
  abstract readonly spec: ForecastSourceSpec;
  /** Injected by each subclass under its own class name. */
  protected abstract readonly logger: PinoLogger;

  protected constructor(private readonly http: JsonRequestService) {}

  async fetchForecast(location: ForecastLocation): Promise<NormalizedForecast> {
    const { label } = this.spec;
    let body: unknown;
    try {
      body = await this.http.get(forecastUrl(this.spec, location), {
        label,
        timeoutMs: OPEN_METEO_TIMEOUT_MS,
      });
    } catch (error) {
      throw error instanceof UpstreamRequestError ? toRefreshError(error) : error;
    }
    try {
      return parseForecastResponse(body, this.spec, location);
    } catch (error) {
      if (error instanceof SourceRefreshError) {
        const detail =
          typeof error.cause === 'string' ? `: ${JsonRequestService.forLog(error.cause)}` : '';
        this.logger.warn(`${label} unavailable (${error.code})${detail}`);
      } else {
        this.logger.warn(`${label} unavailable: ${String(error)}`);
      }
      throw error;
    }
  }
}

/** Maps a failed request to the source failure codes of the Technical Design. */
function toRefreshError(error: UpstreamRequestError): SourceRefreshError {
  const code: SourceFailureCode =
    error.kind === 'TIMEOUT'
      ? 'TIMEOUT'
      : error.kind === 'RATE_LIMITED'
        ? 'RATE_LIMITED'
        : error.kind === 'INVALID_JSON' || error.kind === 'TOO_LARGE'
          ? 'INVALID_PAYLOAD'
          : 'UPSTREAM_FAILURE';
  return new SourceRefreshError(code, error.message, { cause: error, transient: error.transient });
}
