# ADR 0002 Persist forecast snapshots in PostgreSQL with Prisma

**Status** Accepted

## Context

The brief requires persisted weather and leaves storage open. The initial draft favored SQLite for its low setup cost. The project needs durable location identity, cached search lookups and replaceable forecast snapshots that support scoring changes. Vlad selected PostgreSQL and Prisma.

## Decision

Use PostgreSQL, Prisma Client and checked-in Prisma Migrate migrations. Run PostgreSQL locally through Compose by default. Allow an existing instance via its connection URL. Use one Prisma Client per NestJS process and close it on shutdown.

- Key locations by stable Open-Meteo geocoding ID and retain their coordinates and IANA timezone.
- Key search cache entries by normalized city and country filter. Store ordered location IDs and expiry. Cache matches for 24 hours and genuine empty results for one hour. Provider failures and wholly unusable results remain errors.
- Key snapshots by location ID, source and request schema version. Store normalized hourly weather in JSONB and store UTC fetch and coverage bounds in timestamp-with-time-zone columns. Retain requested and returned coordinates, timezone and units. Use atomic upserts after validation so readers see a complete snapshot.

## Consequences

Relational keys support lookups and uniqueness. JSONB keeps a normalized hourly snapshot together and preserves enough input to recompute scores. PostgreSQL adds a local service and migration setup relative to SQLite. Integration and E2E tests use an isolated PostgreSQL database with the same checked-in migrations.

[Storage options and decision](https://app.notion.com/p/417a2e4a6cca81c7b5a8ff5e9cb63aa8) · [Technical Design](https://app.notion.com/p/417a2e4a6cca81949f4df8105ae4f9d8)
