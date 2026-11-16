# ADR 0003 Freeze the local date window and refresh on demand

**Status** Accepted

## Context

The brief asks for the next seven days and leaves refresh policy open. A forecast can be recent and still miss the newly required date after local midnight. A provider error should preserve usable stored weather.

## Decision

Capture the request instant before geocoding and derive tomorrow through the following six calendar dates in the location's IANA timezone. Request eight forecast days, Unix timestamps, the location timezone and explicit metric inputs from Open-Meteo. Convert each instant in the location timezone and verify actual required local-hour coverage separately from finite measurement checks.

Refresh atmosphere and marine independently. Reuse a coverage-complete snapshot under six hours old. On a miss, coalesce refreshes per location and source within the process. Use a five-second timeout per attempt with at most one retry after a timeout, network error or 5xx response. A rate limit can use eligible stale data. Validate payload and coverage before replacing the snapshot. A failed refresh can use a coverage-complete snapshot up to 24 hours old with stale status and failure information. If there is no eligible snapshot, report the source unavailable.

Each waiter checks refreshed coverage for its own frozen date window. A waiter that joined a refresh for a different window and still lacks coverage may start or join one follow-up refresh before applying fallback, when the joined refresh succeeded or failed on coverage.

## Consequences

Stored forecasts survive restart and warm reads avoid provider calls. Misses can wait on upstream and cross-process request coalescing is deferred. Calendar, freshness, failure and concurrency behavior are testable with a fixed clock and controlled fixtures.

## Amendments

- 2026-11-14 (ARC-46), Decision: a timeout counts as a transient failure and is retried once, as for geocoding. The follow-up refresh applies to a waiter that joined any other date window, older or newer, only when that refresh succeeded or failed on coverage, and stays bounded to one. A provider answer over 2 MiB is an invalid payload and is not retried.
- 2026-11-15 (ARC-50), Decision: the 2 MiB limit applies to successful answers only. An error answer keeps its own failure code and retry rule whatever its size, so a 5xx answer over 2 MiB is retried once; its body is read only in part, for the log.

In this repository: [Date window and coverage](../../src/calendar/calendar.logic.ts) · [Refresh and reuse](../../src/forecast/forecast.service.ts) · [Scenario tests](../../test/e2e/forecast-scenarios.e2e-spec.ts)

Author's workspace (may need access): [Finalized persistence specification](https://app.notion.com/p/417a2e4a6cca81018448cfe1a6b90004) · [Technical Design](https://app.notion.com/p/417a2e4a6cca81949f4df8105ae4f9d8)
