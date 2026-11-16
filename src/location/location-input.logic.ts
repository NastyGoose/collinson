import { CITY_MAX_LENGTH, CITY_MIN_LENGTH } from './location.constants';
import { InvalidLocationInputError } from './location.errors';
import type { CitySearch, LocationSelector, LocationSelectorInput } from './location.types';

// Whitespace controls (tab, newline) collapse to a space first; any other control
// character, and any unpaired UTF-16 surrogate, is rejected rather than sent upstream.
const FORBIDDEN_CHARACTERS = /[\p{Cc}\p{Cs}]/u;
// Format characters (zero-width space, joiners, direction marks) are allowed inside a
// name but do not count towards the minimum length, so an invisible city is rejected.
const FORMAT_CHARACTERS = /\p{Cf}/gu;
const COUNTRY_CODE = /^[A-Za-z]{2}$/;

export function normalizeCitySearch(city: string, countryCode?: string | null): CitySearch {
  const name = collapseWhitespace(city.normalize('NFC'));
  // Lengths count Unicode code points, so a character outside the Basic Multilingual
  // Plane counts once, not as two UTF-16 units.
  const length = Array.from(name).length;
  const visibleLength = Array.from(name.replace(FORMAT_CHARACTERS, '')).length;

  if (visibleLength < CITY_MIN_LENGTH || length > CITY_MAX_LENGTH) {
    throw new InvalidLocationInputError(
      `city must be ${CITY_MIN_LENGTH} to ${CITY_MAX_LENGTH} characters after trimming.`,
      'city',
    );
  }
  if (FORBIDDEN_CHARACTERS.test(name)) {
    throw new InvalidLocationInputError('city must not contain control characters.', 'city');
  }

  return {
    query: collapseWhitespace(name.normalize('NFKC')).toLowerCase(),
    countryCode: normalizeCountryCode(countryCode),
  };
}

function collapseWhitespace(text: string): string {
  return text.trim().replace(/\s+/gu, ' ');
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
