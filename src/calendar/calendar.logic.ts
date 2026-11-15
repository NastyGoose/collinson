import { FORECAST_DATE_COUNT } from './calendar.constants';
import type { Coverage, ForecastWindow, LocalDateTime } from './calendar.types';

/** Derives tomorrow and the following six dates in `timezone` for the request instant. */
export function forecastWindow(requestedAt: Date, timezone: string): ForecastWindow {
  const today = toLocalDateTime(requestedAt.getTime(), timezone).date;
  const dates: string[] = [];
  for (let offset = 1; offset <= FORECAST_DATE_COUNT; offset += 1) {
    dates.push(addDays(today, offset));
  }
  return { timezone, dates };
}

/** True when both windows ask for the same dates in the same time zone. */
export function sameWindow(a: ForecastWindow, b: ForecastWindow): boolean {
  return a.timezone === b.timezone && a.dates.join() === b.dates.join();
}

/**
 * Checks that `times` (Unix seconds) holds exactly one instant at each required
 * local hour (hh:00:00) on every date of the window, converting each instant in the
 * window's time zone. An hour with no instant — absent from the payload or skipped
 * by a DST change — or with two is missing. Measurement values play no part.
 * `missing` lists every gap as local `YYYY-MM-DDThh:00`.
 */
export function checkCoverage(
  times: readonly number[],
  window: ForecastWindow,
  requiredHours: readonly number[],
): Coverage {
  const wanted = new Set(window.dates);
  const hours = new Set(requiredHours);
  const counts = new Map<string, number>();
  for (const seconds of times) {
    const local = toLocalDateTime(seconds * 1000, window.timezone);
    if (
      local.minute !== 0 ||
      local.second !== 0 ||
      !wanted.has(local.date) ||
      !hours.has(local.hour)
    ) {
      continue;
    }
    const key = localHourKey(local.date, local.hour);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const missing: string[] = [];
  for (const date of window.dates) {
    for (const hour of requiredHours) {
      const key = localHourKey(date, hour);
      if (counts.get(key) !== 1) {
        missing.push(key);
      }
    }
  }
  return missing.length === 0 ? { complete: true } : { complete: false, missing };
}

/** The wall-clock date and time of an instant in an IANA time zone. */
export function toLocalDateTime(epochMs: number, timezone: string): LocalDateTime {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timezone).formatToParts(epochMs)) {
    parts[part.type] = part.value;
  }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Calendar arithmetic on an ISO date, independent of any time zone. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function localHourKey(date: string, hour: number): string {
  return `${date}T${String(hour).padStart(2, '0')}:00`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (formatter === undefined) {
    // en-CA formats dates as YYYY-MM-DD; h23 keeps midnight as 00, not 24.
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}
