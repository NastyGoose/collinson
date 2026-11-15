import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { UpstreamRequestError } from '../http/http.errors';
import { JsonRequestService } from '../http/json-request.service';
import {
  GEOCODING_REQUEST_COUNT,
  GEOCODING_TIMEOUT_MS,
  OPEN_METEO_GEOCODING_URL,
} from './location.constants';
import { GeocodingUnavailableError, type GeocodingFailureKind } from './location.errors';
import type { Location } from './location.types';
import { parseGeocodingResponse } from './open-meteo-geocoding.mapper';

/**
 * Open-Meteo geocoding adapter. Returns up to five valid, distinct candidates in
 * the provider's order, or an empty list for a genuine no-match. Anything else —
 * a timeout, an HTTP error, a malformed body, or results of which none is usable —
 * is a GeocodingUnavailableError, so callers never mistake an outage for an
 * unknown town. https://open-meteo.com/en/docs/geocoding-api
 */
@Injectable()
export class OpenMeteoGeocodingClient {
  constructor(
    private readonly http: JsonRequestService,
    @InjectPinoLogger(OpenMeteoGeocodingClient.name) private readonly logger: PinoLogger,
  ) {}

  async search(query: string, countryCode: string | null): Promise<Location[]> {
    const url = new URL(OPEN_METEO_GEOCODING_URL);
    url.searchParams.set('name', query);
    url.searchParams.set('count', String(GEOCODING_REQUEST_COUNT));
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');
    if (countryCode !== null) {
      url.searchParams.set('countryCode', countryCode);
    }

    let body: unknown;
    try {
      body = await this.http.get(url, { label: 'Geocoding', timeoutMs: GEOCODING_TIMEOUT_MS });
    } catch (error) {
      throw error instanceof UpstreamRequestError ? toGeocodingError(error) : error;
    }
    try {
      return parseGeocodingResponse(body, countryCode);
    } catch (error) {
      if (error instanceof GeocodingUnavailableError) {
        const detail = typeof error.cause === 'string' ? `: ${this.http.forLog(error.cause)}` : '';
        this.logger.warn(`Geocoding unavailable (${error.kind})${detail}`);
      }
      throw error;
    }
  }
}

/** Maps a failed request to the geocoding failure kinds. */
function toGeocodingError(error: UpstreamRequestError): GeocodingUnavailableError {
  const kind: GeocodingFailureKind =
    error.kind === 'HTTP_ERROR'
      ? 'UPSTREAM_FAILURE'
      : error.kind === 'INVALID_JSON' || error.kind === 'TOO_LARGE'
        ? 'INVALID_PAYLOAD'
        : error.kind;
  return new GeocodingUnavailableError(kind, error.message, {
    cause: error,
    transient: error.transient,
  });
}
