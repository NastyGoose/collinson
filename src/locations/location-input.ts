import { InvalidLocationInputError } from './location.errors';

export const CITY_MIN_LENGTH = 2;
export const CITY_MAX_LENGTH = 120;

/** A validated city search. */
export interface CitySearch {
  /** Trimmed, NFC-normalized city text with whitespace runs collapsed; sent to the provider. */
  query: string;
  /** `query` lowercased: the search cache key. The provider matches case-insensitively. */
  cacheKey: string;
  /** Uppercase ISO 3166-1 alpha-2 filter, or null for no filter. */
  countryCode: string | null;
}

/** Exactly one of a city search or a stored location ID. */
export type LocationSelector =
  { kind: 'city'; search: CitySearch } | { kind: 'id'; locationId: string };

/** The raw selector fields, as they arrive from GraphQL (absent fields may be null). */
export interface LocationSelectorInput {
  city?: string | null;
  countryCode?: string | null;
  locationId?: string | null;
}

// Control characters never appear in place names; reject them rather than send them upstream.
const CONTROL_CHARACTERS = /\p{Cc}/u;
const COUNTRY_CODE = /^[A-Za-z]{2}$/;

export function normalizeCitySearch(city: string, countryCode?: string | null): CitySearch {
  const query = city.normalize('NFC').trim().replace(/\s+/gu, ' ');
  // Length counts Unicode code points, so "Łódź" is four characters, not more.
  const length = Array.from(query).length;

  if (length < CITY_MIN_LENGTH || length > CITY_MAX_LENGTH) {
    throw new InvalidLocationInputError(
      `city must be ${CITY_MIN_LENGTH} to ${CITY_MAX_LENGTH} characters after trimming, got ${length}.`,
      'city',
    );
  }
  if (CONTROL_CHARACTERS.test(query)) {
    throw new InvalidLocationInputError('city must not contain control characters.', 'city');
  }

  return { query, cacheKey: query.toLowerCase(), countryCode: normalizeCountryCode(countryCode) };
}

function normalizeCountryCode(countryCode: string | null | undefined): string | null {
  if (countryCode === null || countryCode === undefined) {
    return null;
  }
  const trimmed = countryCode.trim();
  if (!COUNTRY_CODE.test(trimmed)) {
    throw new InvalidLocationInputError(
      'countryCode must be a two-letter ISO 3166-1 alpha-2 code, e.g. "GB".',
      'countryCode',
    );
  }
  return trimmed.toUpperCase();
}

/**
 * Validates that the input names exactly one selector, a city search or a stored
 * location ID, and normalizes it. A country filter is valid with a city search only.
 */
export function parseLocationSelector(input: LocationSelectorInput): LocationSelector {
  const { city, countryCode, locationId } = input;

  if (city != null && locationId != null) {
    throw new InvalidLocationInputError(
      'Provide exactly one of city or locationId, not both.',
      null,
    );
  }

  if (locationId != null) {
    if (countryCode != null) {
      throw new InvalidLocationInputError(
        'countryCode applies to a city search only; omit it when selecting by locationId.',
        'countryCode',
      );
    }
    const trimmed = locationId.trim();
    if (trimmed === '') {
      throw new InvalidLocationInputError('locationId must not be empty.', 'locationId');
    }
    return { kind: 'id', locationId: trimmed };
  }

  if (city == null) {
    throw new InvalidLocationInputError('Provide exactly one of city or locationId.', null);
  }
  return { kind: 'city', search: normalizeCitySearch(city, countryCode) };
}
