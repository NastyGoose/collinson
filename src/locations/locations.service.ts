import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../clock/clock';
import type { Location } from './location';
import {
  normalizeCitySearch,
  parseLocationSelector,
  type CitySearch,
  type LocationSelectorInput,
} from './location-input';
import { LocationsRepository } from './locations.repository';
import { OpenMeteoGeocodingClient } from './open-meteo-geocoding.client';

/** How long a search with candidates is reused (SPEC-01). */
export const SEARCH_MATCH_TTL_MS = 24 * 60 * 60 * 1000;
/** How long a genuine no-match is reused (SPEC-01). */
export const SEARCH_EMPTY_TTL_MS = 60 * 60 * 1000;

/** The provider's IDs are positive integers; anything else cannot be a stored ID. */
const CANONICAL_LOCATION_ID = /^[1-9][0-9]{0,15}$/;

/** The outcome of resolving a selector, matching the GraphQL union in the Technical Design. */
export type LocationResolution =
  | { kind: 'resolved'; location: Location }
  | { kind: 'ambiguous'; candidates: Location[] }
  | { kind: 'not_found'; message: string };

/**
 * Owns location identity: geocoding, the search cache and stored IDs.
 *
 * Errors: InvalidLocationInputError before any upstream or storage access,
 * GeocodingUnavailableError when a city search needs the provider and it fails,
 * StorageUnavailableError when PostgreSQL cannot serve the operation.
 */
@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);

  constructor(
    private readonly repository: LocationsRepository,
    private readonly geocoding: OpenMeteoGeocodingClient,
    private readonly clock: Clock,
  ) {}

  /**
   * Up to five candidates for a city, in provider order, or an empty list for a
   * genuine no-match. Served from the search cache while it is fresh.
   */
  async search(city: string, countryCode?: string | null): Promise<Location[]> {
    return this.searchNormalized(normalizeCitySearch(city, countryCode));
  }

  /**
   * Resolves exactly one selector. A stored ID never calls geocoding, so it keeps
   * working while the provider is down.
   */
  async resolve(input: LocationSelectorInput): Promise<LocationResolution> {
    const selector = parseLocationSelector(input);

    if (selector.kind === 'id') {
      const location = CANONICAL_LOCATION_ID.test(selector.locationId)
        ? await this.repository.findLocation(selector.locationId)
        : null;
      return location === null
        ? { kind: 'not_found', message: unknownIdMessage(selector.locationId) }
        : { kind: 'resolved', location };
    }

    const candidates = await this.searchNormalized(selector.search);
    if (candidates.length === 0) {
      return { kind: 'not_found', message: notFoundMessage(selector.search) };
    }
    if (candidates.length === 1) {
      return { kind: 'resolved', location: candidates[0] };
    }
    return { kind: 'ambiguous', candidates };
  }

  private async searchNormalized(search: CitySearch): Promise<Location[]> {
    const cached = await this.repository.findFreshSearch(
      search.query,
      search.countryCode,
      this.clock.now(),
    );
    if (cached !== null) {
      return cached.candidates;
    }

    // A provider failure propagates here, before anything is written: failures
    // are never cached, and an existing entry for the key is left as it was.
    const candidates = await this.geocoding.search(search.query, search.countryCode);

    // Taken after the provider answers, so the TTL runs from when the data was fetched.
    const fetchedAt = this.clock.now();
    const ttl = candidates.length > 0 ? SEARCH_MATCH_TTL_MS : SEARCH_EMPTY_TTL_MS;
    await this.repository.saveSearch(
      search.query,
      search.countryCode,
      candidates,
      fetchedAt,
      new Date(fetchedAt.getTime() + ttl),
    );
    await this.purgeExpiredSearches(fetchedAt);
    return candidates;
  }

  /**
   * Keeps the search cache bounded: each fresh fetch also removes a batch of
   * expired searches. Best effort — a failed purge never fails the search.
   */
  private async purgeExpiredSearches(now: Date): Promise<void> {
    try {
      await this.repository.purgeExpiredSearches(now);
    } catch (error) {
      this.logger.warn(`Expired location searches were not purged: ${String(error)}`);
    }
  }
}

function unknownIdMessage(locationId: string): string {
  // Echo only IDs of the provider's form; anything else may be arbitrarily long.
  return CANONICAL_LOCATION_ID.test(locationId)
    ? `No stored location has ID "${locationId}".`
    : 'No stored location has the given ID.';
}

function notFoundMessage(search: CitySearch): string {
  const country = search.countryCode === null ? '' : ` in ${search.countryCode}`;
  return `No location matches "${search.label}"${country}.`;
}
