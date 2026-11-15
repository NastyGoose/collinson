import { thrown } from '../../support/errors';
import { normalizeCitySearch, parseLocationSelector } from '../../../src/locations/location-input';
import { InvalidLocationInputError } from '../../../src/locations/location.errors';

function inputError(run: () => unknown): InvalidLocationInputError {
  return thrown(run, InvalidLocationInputError);
}

describe('normalizeCitySearch', () => {
  it('trims the city, collapses inner whitespace and lowercases the query', () => {
    expect(normalizeCitySearch('  New \t  York  ')).toEqual({
      query: 'new york',
      label: 'New York',
      countryCode: null,
    });
  });

  it('keeps Unicode names and composes them to NFC', () => {
    const search = normalizeCitySearch('São Paulo');

    expect(search.label).toBe('São Paulo');
    expect(search.query).toBe('são paulo');
  });

  it('folds compatibility characters, so look-alike spellings share one query', () => {
    // U+212A KELVIN SIGN lowercases to "k"; NFKC first maps it to the letter K.
    expect(normalizeCitySearch('Kiev').query).toBe(normalizeCitySearch('Kiev').query);
    expect(normalizeCitySearch('Ｂerlin').query).toBe('berlin');
  });

  it('counts code points, so a two-character CJK name is valid', () => {
    expect(normalizeCitySearch('東京').label).toBe('東京');
  });

  it.each([
    ['empty', ''],
    ['whitespace only', ' \t\n '],
    ['one character after trimming', '  A  '],
    ['only zero-width characters', '​​​'],
    ['one letter padded with zero-width characters', 'A​‍'],
  ])('rejects a city that is %s', (_label, city) => {
    const error = inputError(() => normalizeCitySearch(city));

    expect(error.code).toBe('BAD_USER_INPUT');
    expect(error.field).toBe('city');
  });

  it('allows format characters inside a longer name', () => {
    expect(normalizeCitySearch('Mehr‌abad').label).toBe('Mehr‌abad');
  });

  it('accepts exactly 120 characters and rejects 121', () => {
    expect(normalizeCitySearch('a'.repeat(120)).label).toHaveLength(120);
    expect(inputError(() => normalizeCitySearch('a'.repeat(121))).field).toBe('city');
  });

  it('measures the 120-character limit in code points, not UTF-16 units', () => {
    expect(Array.from(normalizeCitySearch('😀'.repeat(120)).label)).toHaveLength(120);
    expect(inputError(() => normalizeCitySearch('😀'.repeat(121))).field).toBe('city');
  });

  it('measures the length after trimming', () => {
    expect(normalizeCitySearch(`   ${'a'.repeat(120)}   `).label).toHaveLength(120);
  });

  it.each([
    ['a NUL character', 'Ber\u0000lin'],
    ['an escape character', 'Ber\u001Blin'],
    ['an unpaired surrogate', 'Ber\uD800lin'],
  ])('rejects %s', (_label, city) => {
    expect(inputError(() => normalizeCitySearch(city)).field).toBe('city');
  });

  it('normalizes the country filter to uppercase', () => {
    expect(normalizeCitySearch('Berlin', ' de ').countryCode).toBe('DE');
  });

  it.each(['', ' ', 'D', 'DEU', 'D1', 'Ä1', 'ÄÖ'])(
    'rejects the country filter %j',
    (countryCode) => {
      expect(inputError(() => normalizeCitySearch('Berlin', countryCode)).field).toBe(
        'countryCode',
      );
    },
  );
});

describe('parseLocationSelector', () => {
  it('selects a city search', () => {
    expect(parseLocationSelector({ city: ' Berlin ', countryCode: 'de' })).toEqual({
      kind: 'city',
      search: { query: 'berlin', label: 'Berlin', countryCode: 'DE' },
    });
  });

  it('selects a stored location ID, trimmed', () => {
    expect(parseLocationSelector({ locationId: ' 2950159 ', city: null })).toEqual({
      kind: 'id',
      locationId: '2950159',
    });
  });

  it.each([
    ['neither selector', {}],
    ['neither selector, both null', { city: null, locationId: null }],
    ['both selectors', { city: 'Berlin', locationId: '2950159' }],
    ['both selectors with an empty city', { city: '', locationId: '2950159' }],
  ])('rejects %s', (_label, input) => {
    const error = inputError(() => parseLocationSelector(input));

    expect(error.code).toBe('BAD_USER_INPUT');
    expect(error.field).toBeNull();
  });

  it('rejects a country filter with a location ID', () => {
    expect(
      inputError(() => parseLocationSelector({ locationId: '2950159', countryCode: 'DE' })).field,
    ).toBe('countryCode');
  });

  it('rejects a blank location ID', () => {
    expect(inputError(() => parseLocationSelector({ locationId: '   ' })).field).toBe('locationId');
  });

  it('validates the city of a city selector', () => {
    expect(inputError(() => parseLocationSelector({ city: '   ' })).field).toBe('city');
  });
});
