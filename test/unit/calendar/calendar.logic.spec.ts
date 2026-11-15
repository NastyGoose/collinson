import {
  addDays,
  checkCoverage,
  forecastWindow,
  sameWindow,
  toLocalDateTime,
} from '../../../src/calendar/calendar.logic';

const HOUR_S = 3600;

function hours(firstHourUtc: string, count: number): number[] {
  const first = Date.parse(firstHourUtc) / 1000;
  return Array.from({ length: count }, (_, index) => first + index * HOUR_S);
}

const NINE_TO_SIX = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

describe('forecastWindow', () => {
  it('starts tomorrow in the location time zone and spans seven dates', () => {
    expect(forecastWindow(new Date('2026-11-14T12:00:00Z'), 'Europe/Lisbon')).toEqual({
      timezone: 'Europe/Lisbon',
      dates: [
        '2026-11-15',
        '2026-11-16',
        '2026-11-17',
        '2026-11-18',
        '2026-11-19',
        '2026-11-20',
        '2026-11-21',
      ],
    });
  });

  it('uses the local date, not the UTC date, around local midnight', () => {
    // 23:30 UTC on the 14th is already 00:30 on the 15th in Warsaw (UTC+1).
    const warsaw = forecastWindow(new Date('2026-11-14T23:30:00Z'), 'Europe/Warsaw');
    expect(warsaw.dates[0]).toBe('2026-11-16');

    // 03:00 UTC on the 15th is still the 14th in New York (UTC−5).
    const newYork = forecastWindow(new Date('2026-11-15T03:00:00Z'), 'America/New_York');
    expect(newYork.dates[0]).toBe('2026-11-15');
  });

  it('rolls over month and year boundaries', () => {
    const window = forecastWindow(new Date('2026-12-28T10:00:00Z'), 'UTC');
    expect(window.dates[0]).toBe('2026-12-29');
    expect(window.dates[6]).toBe('2027-01-04');
  });

  it('keeps a window for each frozen instant either side of midnight', () => {
    const before = forecastWindow(new Date('2026-11-14T22:59:59Z'), 'Europe/Warsaw');
    const after = forecastWindow(new Date('2026-11-14T23:00:00Z'), 'Europe/Warsaw');
    expect(before.dates[0]).toBe('2026-11-15');
    expect(after.dates[0]).toBe('2026-11-16');
    expect(sameWindow(before, after)).toBe(false);
    expect(sameWindow(before, { ...before, dates: [...before.dates] })).toBe(true);
  });
});

describe('addDays', () => {
  it('does calendar arithmetic across a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-28', 2)).toBe('2028-03-01');
  });
});

describe('toLocalDateTime', () => {
  it('reports midnight as hour 0', () => {
    expect(toLocalDateTime(Date.parse('2026-11-14T23:00:00Z'), 'Europe/Warsaw')).toEqual({
      date: '2026-11-15',
      hour: 0,
      minute: 0,
      second: 0,
    });
  });
});

describe('checkCoverage', () => {
  const window = forecastWindow(new Date('2026-11-14T12:00:00Z'), 'Europe/Lisbon');

  it('accepts eight days of hourly instants from local midnight today', () => {
    expect(checkCoverage(hours('2026-11-14T00:00:00Z', 192), window, NINE_TO_SIX)).toEqual({
      complete: true,
    });
  });

  it('reports a missing required hour', () => {
    const times = hours('2026-11-14T00:00:00Z', 192).filter(
      (time) => time !== Date.parse('2026-11-18T18:00:00Z') / 1000,
    );
    expect(checkCoverage(times, window, NINE_TO_SIX)).toEqual({
      complete: false,
      missing: ['2026-11-18T18:00'],
    });
  });

  it('ignores hours outside the required set', () => {
    const times = hours('2026-11-14T00:00:00Z', 192).filter(
      (time) => time !== Date.parse('2026-11-18T08:00:00Z') / 1000,
    );
    expect(checkCoverage(times, window, NINE_TO_SIX)).toEqual({ complete: true });
  });

  it('reports the last date when the payload stops short of it', () => {
    // Seven days from today ends on the 20th; the window needs the 21st.
    const result = checkCoverage(hours('2026-11-14T00:00:00Z', 168), window, NINE_TO_SIX);
    expect(result.complete).toBe(false);
    expect(result.complete === false && result.missing).toEqual(
      NINE_TO_SIX.map((hour) => `2026-11-21T${String(hour).padStart(2, '0')}:00`),
    );
  });

  it('reads instants in the window time zone, not UTC', () => {
    // The last row is 17:00 UTC on the 21st: 17:00 in Lisbon (UTC+0) but 18:00 in Warsaw (UTC+1).
    const times = hours('2026-11-14T00:00:00Z', 186);
    const warsaw = forecastWindow(new Date('2026-11-14T12:00:00Z'), 'Europe/Warsaw');
    expect(checkCoverage(times, warsaw, NINE_TO_SIX)).toEqual({ complete: true });
    expect(checkCoverage(times, window, NINE_TO_SIX)).toEqual({
      complete: false,
      missing: ['2026-11-21T18:00'],
    });
  });

  it('treats a duplicated instant at a required hour as missing', () => {
    const times = hours('2026-11-14T00:00:00Z', 192);
    const duplicate = Date.parse('2026-11-16T12:00:00Z') / 1000;
    const result = checkCoverage([...times, duplicate], window, NINE_TO_SIX);
    expect(result).toEqual({ complete: false, missing: ['2026-11-16T12:00'] });
  });

  it('ignores instants that are not on the hour', () => {
    const times = hours('2026-11-14T00:30:00Z', 192);
    const result = checkCoverage(times, window, [9]);
    expect(result.complete).toBe(false);
  });

  it('is independent of measurement values: only timestamps count', () => {
    expect(checkCoverage([], window, NINE_TO_SIX).complete).toBe(false);
  });

  it('covers the required hours across a DST change', () => {
    // Europe/Lisbon leaves summer time on 2026-10-25: 01:00 local happens twice and the day
    // has 25 hours. Hourly instants from local midnight still hit 09:00–18:00 exactly once.
    const dstWindow = forecastWindow(new Date('2026-10-22T12:00:00Z'), 'Europe/Lisbon');
    expect(dstWindow.dates).toContain('2026-10-25');
    const times = hours('2026-10-21T23:00:00Z', 8 * 24 + 1);
    expect(checkCoverage(times, dstWindow, NINE_TO_SIX)).toEqual({ complete: true });
  });

  it('reports an hour skipped by the spring DST change', () => {
    // New York skips 02:00 on 2027-03-14; a window requiring 02:00 cannot be covered.
    const window = forecastWindow(new Date('2027-03-12T12:00:00Z'), 'America/New_York');
    const times = hours('2027-03-12T05:00:00Z', 8 * 24);
    expect(checkCoverage(times, window, [2])).toEqual({
      complete: false,
      missing: ['2027-03-14T02:00'],
    });
  });
});
