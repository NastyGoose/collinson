# Collinson: seven-day activity weather ranking

A backend assessment service. Given a city or town, it ranks the next seven days for four activities: skiing, surfing, outdoor sightseeing and indoor sightseeing.

## Scope

- Node.js backend with a GraphQL API (NestJS).
- Weather from [Open-Meteo](https://open-meteo.com/), persisted in PostgreSQL (via Prisma) rather than fetched on every request.
- Deterministic, explainable scoring for each activity and date.
- Backend only. No frontend, accounts, booking, venue lookup or hosted deployment.

## Status

The service skeleton is in place (ARC-44): NestJS with a schema-first GraphQL endpoint, PostgreSQL through Docker Compose, Prisma with checked-in migrations, and unit, integration and E2E test tiers. Besides the `health` probe it serves `locations` and `activityForecast` (ARC-48), described under [GraphQL queries](#graphql-queries).

Location resolution (ARC-45) geocodes a city through [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api), stores locations under their stable Open-Meteo IDs, caches searches by normalized city and country filter (24 hours for matches, one hour for a genuine no-match, provider failures never cached, expired entries purged on later fetches) and resolves a stored ID without geocoding.

Forecast persistence (ARC-46) fetches eight days of hourly weather from the [Open-Meteo forecast](https://open-meteo.com/en/docs) and [marine](https://open-meteo.com/en/docs/marine-weather-api) APIs as two independent sources, validates units, timestamps and array alignment while keeping null measurements, and stores one normalized snapshot per location, source and request schema version in PostgreSQL. A snapshot is reused while it is under six hours old and still covers the required local hours of the seven requested dates. Concurrent refreshes of the same location and source in one process share one request; each attempt has a five-second timeout and timeouts, network errors and 5xx answers are retried once; rate limits, other 4xx answers, invalid payloads and answers over 2 MiB are not. A refresh that fails, does not validate or does not cover the requested dates never replaces the stored snapshot, which is then served as stale for up to 24 hours if it still covers the dates; otherwise the source is reported unavailable.

Activity scoring v1 (ARC-47) is a pure function. For each of the seven local dates it reads nine samples per field: temperature, snow depth, 10 m wind and waves at 09:00–17:00, and precipitation at 10:00–18:00 because each value covers the preceding hour. It uses mean temperature and snow depth, total precipitation, maximum wind and median wave height and period, with the weights and breakpoints in [ADR 0005](docs/adr/0005-deterministic-activity-scoring.md). Each activity is ranked on its own by rounded score, then date; a day missing its source, any of the nine samples of a field it uses or, for surfing, a valid marine grid point within 25 km is listed last with a null score and a typed reason. A measured zero, such as no snow, is scored rather than treated as missing.

The GraphQL contract (ARC-48) wires these together. `activityForecast` takes the request instant before it resolves the location, derives tomorrow and the six following dates in the location's time zone once, reads both weather sources and scores them. A resolved location always gets four activity groups of seven dates and both source statuses, atmospheric first; a source outage shows as `UNAVAILABLE` in `sources` and as unavailable days with null score and rank, never as a GraphQL error.

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

## GraphQL queries

The schema is [`src/activity-forecast/activity-forecast.graphql`](src/activity-forecast/activity-forecast.graphql). Search for a place:

```graphql
{
  locations(city: "Springfield", countryCode: "US") {
    id
    name
    region
    country
    timezone
  }
}
```

Rank the next seven days, by city or by an `id` from `locations`:

```graphql
query Forecast($input: ForecastInput!) {
  activityForecast(input: $input) {
    __typename
    ... on ActivityForecast {
      location {
        id
        name
        country
        timezone
      }
      startDate
      endDate
      scoringVersion
      activities {
        activity
        days {
          date
          availability
          score
          rank
          reason
          unavailableCode
        }
      }
      sources {
        source
        freshness
        fetchedAt
        failureCode
        reason
      }
      attribution
    }
    ... on AmbiguousLocation {
      candidates {
        id
        name
        region
        country
      }
    }
    ... on LocationNotFound {
      message
    }
  }
}
```

with variables such as `{ "input": { "city": "Nazaré", "countryCode": "PT" } }`, which matches one place. Pass exactly one of `city` and `locationId`; `countryCode` filters a city search only. A city with several matches returns `AmbiguousLocation`: every candidate is stored, so repeat the query with one candidate's `id`, as in `{ "input": { "locationId": "2264923" } }`. A stored ID resolves without geocoding, even while geocoding is down. An unknown city or ID returns `LocationNotFound`.

Errors carry a stable `extensions.code`: `BAD_USER_INPUT` for an invalid selector or filter (with `extensions.field` naming the input at fault, or null for the selector as a whole), `GEOCODING_UNAVAILABLE` when a city search needs Open-Meteo geocoding and it fails, and `STORAGE_UNAVAILABLE` when PostgreSQL cannot serve the request. GraphQL's own request errors keep their codes, such as `GRAPHQL_VALIDATION_FAILED` for an unknown field. Any other failure is reported as `INTERNAL_SERVER_ERROR` with a generic message; details go to the server log only.

Weather and location data come from [Open-Meteo](https://open-meteo.com/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); every forecast repeats this in `attribution`.

## Tests and checks

```bash
npm test                   # unit tests, no database
npm run test:integration   # migrations, location and forecast persistence against a fresh PostgreSQL database
npm run test:e2e           # the GraphQL contract and acceptance scenarios over HTTP, with a fixed clock and fixture Open-Meteo answers, against a fresh PostgreSQL database
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
