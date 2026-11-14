import { normalizeCitySearch, parseLocationSelector } from './location-input';
import { InvalidLocationInputError } from './location.errors';

function inputError(run: () => unknown): InvalidLocationInputError {
  try {
    run();
  } catch (error) {
    if (error instanceof InvalidLocationInputError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected an InvalidLocationInputError');
}

describe('normalizeCitySearch', () => {
  it('trims the city and collapses inner whitespace', () => {
    expect(normalizeCitySearch('  New \t  York  ')).toEqual({
      query: 'New York',
      cacheKey: 'new york',
      countryCode: null,
    });
  });

  it('keeps Unicode names and composes them to NFC', () => {
    const decomposed = 'São Paulo';

    const search = normalizeCitySearch(decomposed);

    expect(search.query).toBe('São Paulo');
    expect(search.query).toBe('São Paulo');
    expect(search.cacheKey).toBe('são paulo');
  });

  it('counts code points, so a two-character CJK name is valid', () => {
    expect(normalizeCitySearch('東京').query).toBe('東京');
  });

  it.each([
    ['empty', ''],
    ['whitespace only', ' \t\n '],
    ['one character after trimming', '  A  '],
  ])('rejects a city that is %s', (_label, city) => {
    const error = inputError(() => normalizeCitySearch(city));

    expect(error.code).toBe('BAD_USER_INPUT');
    expect(error.field).toBe('city');
  });

  it('accepts exactly 120 characters and rejects 121', () => {
    expect(normalizeCitySearch('a'.repeat(120)).query).toHaveLength(120);
    expect(inputError(() => normalizeCitySearch('a'.repeat(121))).field).toBe('city');
  });

  it('measures the length after trimming', () => {
    expect(normalizeCitySearch(`   ${'a'.repeat(120)}   `).query).toHaveLength(120);
  });

  it('rejects control characters', () => {
    expect(inputError(() => normalizeCitySearch('Ber\u0000lin')).field).toBe('city');
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
      search: { query: 'Berlin', cacheKey: 'berlin', countryCode: 'DE' },
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
