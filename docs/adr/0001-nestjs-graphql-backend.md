# ADR 0001 Use a single NestJS GraphQL backend

**Status** Accepted

## Context

The brief requires Node.js, GraphQL and a backend-only submission. Vlad selected NestJS. Place names can be ambiguous, and the two forecast sources can fail independently.

## Decision

Run one NestJS process in TypeScript. Separate location resolution, forecast acquisition and persistence, and activity scoring. The GraphQL layer orchestrates those services and maps results to the published SDL. Use `locations` for discovery and `activityForecast` for ranking. Resolve city queries to at most five valid distinct candidates. Return typed ambiguity and unknown-location outcomes. For a resolved location, return four groups of seven dated entries even if both weather sources are unavailable. Expose independent freshness metadata, nullable score and rank for unavailable days, and typed reasons. Use the Technical Design's GraphQL error codes for invalid input, geocoding failures and storage failures.

## Amendments

- 2026-11-15 (ARC-48), Decision: an error without a documented or GraphQL request code, such as a bug or an unexpected database error, reaches clients as `INTERNAL_SERVER_ERROR` with a generic message and no stack trace; the server log keeps the details. Location and storage errors are mapped to their codes by an exception filter, so these expected outcomes are not logged as server errors.

## Consequences

A single process supports a straightforward local setup. Module boundaries allow scoring and provider behavior to be tested independently. A stored location ID remains useful during geocoding outages, and consumers can distinguish location selection, infrastructure errors and weather availability.

[Finalized specifications](https://app.notion.com/p/417a2e4a6cca81c7b5a8ff5e9cb63aa8) · [Technical Design and SDL](https://app.notion.com/p/417a2e4a6cca81949f4df8105ae4f9d8)
