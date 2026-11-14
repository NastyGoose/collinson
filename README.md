# Collinson: seven-day activity weather ranking

A backend assessment service. Given a city or town, it ranks the next seven days for four activities: skiing, surfing, outdoor sightseeing and indoor sightseeing.

## Scope

- Node.js backend with a GraphQL API (NestJS).
- Weather from [Open-Meteo](https://open-meteo.com/), persisted in PostgreSQL (via Prisma) rather than fetched on every request.
- Deterministic, explainable scoring for each activity and date.
- Backend only. No frontend, accounts, booking, venue lookup or hosted deployment.

## Status

The service skeleton is in place (ARC-44): NestJS with a schema-first GraphQL endpoint, PostgreSQL through Docker Compose, Prisma with checked-in migrations, and unit, integration and E2E test tiers. The only query so far is `health`.

Location resolution (ARC-45) is implemented as a service, not yet exposed over GraphQL. It geocodes a city through [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api), stores locations under their stable Open-Meteo IDs, caches searches by normalized city and country filter (24 hours for matches, one hour for a genuine no-match, provider failures never cached, expired entries purged on later fetches) and resolves a stored ID without geocoding. Scoring and the GraphQL `locations` and `activityForecast` queries arrive in ARC-47 and ARC-48.

Forecast persistence (ARC-46) is implemented as a service, not yet exposed over GraphQL. It fetches eight days of hourly weather from the [Open-Meteo forecast](https://open-meteo.com/en/docs) and [marine](https://open-meteo.com/en/docs/marine-weather-api) APIs as two independent sources, validates units, timestamps and array alignment while keeping null measurements, and stores one normalized snapshot per location, source and request schema version in PostgreSQL. A snapshot is reused while it is under six hours old and still covers the required local hours of the seven requested dates. Concurrent refreshes of the same location and source in one process share one request; each attempt has a five-second timeout and timeouts, network errors and 5xx answers are retried once; rate limits, other 4xx answers, invalid payloads and answers over 2 MiB are not. A refresh that fails, does not validate or does not cover the requested dates never replaces the stored snapshot, which is then served as stale for up to 24 hours if it still covers the dates; otherwise the source is reported unavailable.

## Prerequisites

- Node.js 24 or later, and npm
- Docker with the Compose plugin, for the local PostgreSQL. To use an existing PostgreSQL instance instead, set the URLs in `.env` and skip `npm run db:up`.

## Run locally

```bash
npm install                # also generates the Prisma Client
cp .env.example .env       # PowerShell: Copy-Item .env.example .env
npm run db:up              # starts PostgreSQL 17 and waits until it is healthy
npm run db:migrate         # applies the checked-in migrations (prisma migrate deploy)
npm run start              # GraphQL endpoint at http://localhost:3000/graphql
```

Smoke query, from a second terminal:

```bash
curl -s http://localhost:3000/graphql -H 'content-type: application/json' -d '{"query":"{ health { service database } }"}'
```

PowerShell:

```powershell
Invoke-RestMethod http://localhost:3000/graphql -Method Post -ContentType 'application/json' -Body '{"query":"{ health { service database } }"}' | ConvertTo-Json -Depth 5
```

Expected response:

```json
{ "data": { "health": { "service": "UP", "database": "UP" } } }
```

`database` reads `DOWN` when PostgreSQL is unreachable; the endpoint itself keeps answering. Stop the app with Ctrl+C, which closes the Prisma connection pool. Stop PostgreSQL with `npm run db:down`; its data stays in the `collinson_postgres-data` volume.

## Tests and checks

```bash
npm test                   # unit tests, no database
npm run test:integration   # migrations, location and forecast persistence against a fresh PostgreSQL database
npm run test:e2e           # GraphQL over HTTP against a fresh PostgreSQL database
npm run typecheck
npm run lint
npm run format:check
```

Integration and E2E runs never use the development database. Each run connects through `TEST_DATABASE_ADMIN_URL`, creates its own `collinson_test_*` database, applies the same checked-in migrations with `prisma migrate deploy` and drops the database afterwards. The role in that URL needs the `CREATEDB` privilege; the Compose role has it.

## Database migrations

Migrations live in `prisma/migrations` and are applied with `npm run db:migrate`. After changing `prisma/schema.prisma`, create the next migration with `npm run db:migrate:dev -- --name <change>`, regenerate the client with `npm run prisma:generate` (Prisma 7's `migrate dev` no longer does it) and commit the migration folder. `npm run db:status` compares a database with the migration history.

## Project documents

- [CLAUDE.md](CLAUDE.md): instructions for Claude Code, sources of truth and implementation rules.
- [ADR index](docs/adr/README.md): accepted architecture decisions and their rationale.
- [Initial specification draft](docs/assessment-specifications.md): historical draft, superseded by the finalized specifications where they differ.
- [Claude skills](.claude/README.md): reusable task and PR workflow skills in `.claude/skills/`.
