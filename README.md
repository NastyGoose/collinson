# Collinson: seven-day activity weather ranking

A backend service for a take-home assessment. Given a city or town, it ranks the next seven days for skiing, surfing, outdoor sightseeing and indoor sightseeing, using [Open-Meteo](https://open-meteo.com/) weather that it stores in PostgreSQL. It is a NestJS GraphQL API with no frontend.

How the work was planned and decided, including what the AI suggested and what was changed or cut, is in [docs/engineering-notes.md](docs/engineering-notes.md).

## How it works

1. **Location.** A city search goes to Open-Meteo geocoding. One match is used directly, several matches come back as candidates to choose from, and every candidate is stored under its stable Open-Meteo ID. A stored ID resolves without geocoding.
2. **Dates.** The request time is fixed before anything else, and the seven dates are tomorrow and the six days after it in the location's own time zone.
3. **Weather.** Atmospheric weather (temperature, precipitation, snow depth, wind) and marine weather (wave height and period) are two independent sources. Each is stored as one snapshot per location in PostgreSQL and reused for six hours while it still covers the requested dates.
4. **Scores.** A pure, versioned function scores every date from the weather between 09:00 and 18:00 local time and ranks each activity separately. Every day comes with a sentence that cites the inputs behind its score.

## Prerequisites

- Node.js 24 or later, with npm.
- Docker with the Compose plugin, for the local PostgreSQL 17. To use your own PostgreSQL instead, point the URLs in `.env` at it and skip `npm run db:up`.
- Internet access to `*.open-meteo.com` to run the service. The automated tests do not use the network.

## Set up and run

From the repository root:

```bash
npm ci                     # installs the locked dependencies and generates the Prisma Client
cp .env.example .env       # PowerShell: Copy-Item .env.example .env
npm run db:up              # starts PostgreSQL in Docker and waits until it is healthy
npm run db:migrate         # applies the checked-in migrations (prisma migrate deploy)
npm run build
npm run start:prod         # GraphQL endpoint at http://localhost:3000/graphql
```

npm 11 may warn during `npm ci` that it skipped the install scripts of `prisma` and `@prisma/engines`. Setup, migrations and tests work without them. `npm run start` (compile and run) and `npm run start:dev` (watch mode) also work. The defaults in `.env.example` match `compose.yaml`. If port 5432 is already in use, set `POSTGRES_PORT` in `.env` and change the port in both URLs. If `DATABASE_URL` is missing or invalid, the app stops at startup and names the key to fix. Logs are JSON lines on stdout at `info`; set `LOG_LEVEL` (`fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`) to change that. GraphQL introspection is on unless `NODE_ENV` is `production`; set `GRAPHQL_INTROSPECTION` to `true` or `false` to choose explicitly.

Check that it is up, from a second terminal:

```bash
curl -s http://localhost:3000/graphql -H 'content-type: application/json' --data-binary @examples/health.json
```

The answer is `{"data":{"health":{"service":"UP","database":"UP"}}}`. `database` reads `DOWN` while PostgreSQL is unreachable. Stop the app with Ctrl+C and PostgreSQL with `npm run db:down`. The data stays in the `collinson_postgres-data` volume.

## GraphQL examples

Opening http://localhost:3000/graphql in a browser shows GraphiQL, where you can paste the queries below. The schema is [`src/activity-forecast/activity-forecast.graphql`](src/activity-forecast/activity-forecast.graphql). The request bodies are in [`examples/`](examples/) and can be sent as they are:

```bash
curl -s http://localhost:3000/graphql -H 'content-type: application/json' --data-binary @examples/forecast-by-city.json
```

PowerShell:

```powershell
Invoke-RestMethod http://localhost:3000/graphql -Method Post -ContentType 'application/json' -InFile examples/forecast-by-city.json | ConvertTo-Json -Depth 10
```

| File | Request | Expected result |
| --- | --- | --- |
| `examples/locations.json` | `locations(city: "Springfield", countryCode: "US")` | Up to five candidates with IDs, regions and time zones |
| `examples/forecast-by-city.json` | `activityForecast` for `{ "city": "Nazaré", "countryCode": "PT" }` | `ActivityForecast`: four activities with seven ranked days each |
| `examples/forecast-ambiguous.json` | `activityForecast` for `{ "city": "Madrid", "countryCode": "ES" }` | `AmbiguousLocation`: Madrid, Madridejos and other candidates |
| `examples/forecast-by-id.json` | `activityForecast` for `{ "locationId": "3117735" }` (Madrid) | `ActivityForecast` for the chosen candidate. Surfing is unavailable inland |

The forecast query used by these files:

```graphql
query Forecast($input: ForecastInput!) {
  activityForecast(input: $input) {
    __typename
    ... on ActivityForecast {
      location { id name region country latitude longitude timezone }
      startDate
      endDate
      scoringVersion
      activities {
        activity
        days { date availability score rank reason unavailableCode }
      }
      sources { source freshness fetchedAt failureCode reason }
      attribution
    }
    ... on AmbiguousLocation {
      candidates { id name region country timezone }
    }
    ... on LocationNotFound {
      message
    }
  }
}
```

Pass exactly one of `city` and `locationId`. `countryCode` narrows a city search only. To resolve an `AmbiguousLocation`, repeat the query with a candidate's `id`. An unknown city or ID returns `LocationNotFound`. An ID works only after a search has stored it, so on a fresh database send `forecast-ambiguous.json` before `forecast-by-id.json`.

A trimmed response for Nazaré, recorded on 15 November 2026. Live values change with the forecast:

```json
{
  "__typename": "ActivityForecast",
  "location": { "id": "2265552", "name": "Nazaré", "country": "Portugal", "timezone": "Europe/Lisbon" },
  "startDate": "2026-11-16",
  "endDate": "2026-11-22",
  "scoringVersion": "v1",
  "activities": [
    {
      "activity": "OUTDOOR_SIGHTSEEING",
      "days": [
        {
          "date": "2026-11-17",
          "availability": "AVAILABLE",
          "score": 90,
          "rank": 1,
          "reason": "Mean 18.9 °C, 0.1 mm of precipitation and wind up to 20.9 km/h in the 09:00–18:00 window; wind lowers the score most.",
          "unavailableCode": null
        }
      ]
    }
  ],
  "sources": [
    { "source": "ATMOSPHERIC", "freshness": "FRESH", "fetchedAt": "2026-11-15T13:07:55.628Z", "failureCode": null, "reason": null },
    { "source": "MARINE", "freshness": "FRESH", "fetchedAt": "2026-11-15T13:07:55.621Z", "failureCode": null, "reason": null }
  ],
  "attribution": "Weather and location data by Open-Meteo.com (https://open-meteo.com/), licensed under CC BY 4.0."
}
```

When a day cannot be scored it stays in the list with a null score and rank, a reason and a code. For Madrid, an inland city, the marine source is fresh but has no wave values:

```json
{
  "date": "2026-11-16",
  "availability": "UNAVAILABLE",
  "score": null,
  "rank": null,
  "reason": "Missing usable wave height (all 9 hours) and wave period (all 9 hours), so surfing cannot be scored.",
  "unavailableCode": "MISSING_MARINE_INPUTS"
}
```

If Open-Meteo fails, the source shows `STALE` with the stored snapshot's `fetchedAt` and the failure, or `UNAVAILABLE` with a null `fetchedAt` when no usable snapshot exists. Unavailable sources make their days unavailable with `ATMOSPHERIC_UNAVAILABLE` or `MARINE_UNAVAILABLE`. A source failure is never a GraphQL error.

Errors carry a stable `extensions.code`:

- `BAD_USER_INPUT` for an invalid selector or filter. When the service rejects the input, `extensions.field` names it, or is null when the selector as a whole is wrong. GraphQL's own variable errors, such as a missing `input` or a number where a string belongs, use the same code and HTTP 400 with a fixed message, `Variable "$input" is missing or does not match type "ForecastInput!".` They have no `field`, because GraphQL reports the position inside the variable only as text.
- `GEOCODING_UNAVAILABLE` when a city search needs Open-Meteo geocoding and it fails.
- `STORAGE_UNAVAILABLE` when PostgreSQL cannot serve the request.

GraphQL's own request errors keep their codes, such as `GRAPHQL_VALIDATION_FAILED`. A body that is not valid JSON gets HTTP 400 with `{"errors":[{"message":"The request body is not valid JSON.","extensions":{"code":"BAD_REQUEST"}}]}`. Error messages and `LocationNotFound` never repeat the submitted city, ID or variable values, the request body, the requested path or provider text. Parse errors, validation errors on a value written in the query and an unknown `operationName` keep their codes, and their locations where they have any, but get fixed messages. Validation errors about names, such as `Cannot query field "x" on type "Query".` or an undeclared input field, keep their message. Any other failure returns `INTERNAL_SERVER_ERROR` with a generic message, and the details go only to the server log.

## Optional: review console

The service has no front end. For reviewers there is an optional local page that walks through the service step by step. It sends the same GraphQL requests as the files in `examples/` to the running service and shows the answers, with diagrams and notes on the decisions and trade-offs behind each step. It lives in [`tools/review-console/`](tools/review-console/), outside `src/`, and adds no dependency.

With the service running (`npm run start:prod`), in a second terminal:

```bash
npm run review:console     # then open http://localhost:4000
```

Set `REVIEW_CONSOLE_PORT` to use another port. The console listens on localhost only and refuses requests that do not come from its own page. Besides forwarding requests, it reads a few rows from PostgreSQL to show what is stored, and it can start `npm test`, `npm run test:e2e` and `npm run lint:structure`. One button, "Clear stored weather for Nazaré", deletes that location's rows from `forecast_snapshots` in your local database to show a cold request, and asks for a second click first. Everything it shows can also be checked with the curl commands above.

## Tests and checks

```bash
npm test                   # unit: scoring, calendar and DST edges, adapters, mapping (no database, no network)
npm run test:integration   # migrations, location and forecast persistence against PostgreSQL
npm run test:e2e           # the GraphQL contract and acceptance scenarios over HTTP
npm run typecheck
npm run lint
npm run lint:structure     # module boundaries from ADR 0006 (dependency-cruiser)
npm run format:check
```

Test runs are silent and ignore `LOG_LEVEL`; set `TEST_LOG_LEVEL` for one run, such as `TEST_LOG_LEVEL=warn npm run test:e2e`, to see the service's logs. Unit specs live in `test/unit/`, mirroring `src/` ([ADR 0006](docs/adr/0006-module-layout-and-naming.md)). `lint:structure` fails on any boundary violation.

Integration and E2E tests need PostgreSQL running (`npm run db:up`) but never touch the development database. Each run connects with `TEST_DATABASE_ADMIN_URL`, creates its own `collinson_test_*` database, applies the checked-in migrations with `prisma migrate deploy` and drops the database at the end. The role in that URL needs the `CREATEDB` privilege, which the Compose role has. The tests use a fixed clock and a fake Open-Meteo that answers from fixtures, so they are deterministic and run offline.

[CI](.github/workflows/ci.yml) runs these checks on every pull request and every push to `main`, against a PostgreSQL 17 service container. It then applies the migrations to an empty database, starts the built app and checks the `health` query.

A live check against the real Open-Meteo is optional and not part of CI. Start the app, then run `npm run smoke:live`. It sends every file in `examples/`, in an order that stores Madrid before it is requested by ID, and checks the shape of each answer. A file without a check fails the run. On GitHub it can be started by hand as the [Live smoke workflow](.github/workflows/live-smoke.yml).

## Assumptions and limits

**Locations**

- City names are trimmed and must be 2 to 120 characters long. A country filter is a two-letter code such as `PT`, and an unknown code finds nothing.
- A search returns at most five candidates. Searches are cached for 24 hours, or one hour when nothing matched. Provider failures are never cached.
- A cached search is not served after it expires, even when geocoding is down. Querying by a stored ID still works during an outage.

**Dates**

- The seven dates run from tomorrow to six days after tomorrow in the location's time zone, based on the moment the request arrives. Today is not ranked because part of it may already be over.
- Times are local, using the IANA time zone and the provider's Unix timestamps, so DST changes and half-hour zones are handled. Dates are ISO local dates and timestamps are UTC.

**Weather and storage**

- Each source keeps one snapshot per location. A snapshot is reused while it is under six hours old and covers the needed local hours of all seven dates.
- When a refresh fails, a snapshot up to 24 hours old that still covers the dates is served as `STALE`. Otherwise the source is `UNAVAILABLE`. A refresh that fails or does not validate never replaces the stored snapshot.
- Each provider call has a five-second timeout. Timeouts, network errors and 5xx answers are retried once. Rate limits, other 4xx answers, invalid payloads and successful answers over 2 MiB are not retried.
- Simultaneous refreshes are merged within one process only. Several app instances could each call Open-Meteo once.

**Scoring (v1, [ADR 0005](docs/adr/0005-deterministic-activity-scoring.md))**

- The scores describe how suitable the weather is for a generic visitor. They are not safety advice and do not account for skill level, resorts, lifts or beaches.
- Each date uses nine local hours: temperature, snow depth, wind and waves at 09:00–17:00, and precipitation at 10:00–18:00, because each precipitation value covers the hour before it.
- Outdoor sightseeing is 50% temperature (best at 20 °C), 30% precipitation and 20% wind. Indoor sightseeing is 50 + half of what outdoor loses, so it rises as outdoor conditions get worse. Skiing is 0 when there is no snow on the ground; otherwise it is 50% snow depth, 30% temperature (best at −5 °C) and 20% wind. Surfing is 50% wave height (best at 1.2 m), 30% wave period and 20% wind.
- Days are ranked by rounded score, with ties broken by the earlier date. A day missing any of the nine values it needs is unavailable rather than guessed. A measured zero, such as no snow or no rain, still counts as a value.
- Surfing needs a marine grid point within 25 km. Open-Meteo returns the nearest sea grid cell, which says nothing about beach access. The 25 km limit is an assumption ([ADR 0004](docs/adr/0004-marine-data-eligibility.md)).

**Out of scope**

There is no product frontend (the [review console](#optional-review-console) is a reviewer aid outside the service), user accounts, booking, resort or beach lookup, personal preferences, historical analytics, background refresh workers, authentication, rate limiting or hosted deployment.

## Database migrations

Migrations live in `prisma/migrations` and are applied with `npm run db:migrate`. After changing `prisma/schema.prisma`, create the next migration with `npm run db:migrate:dev -- --name <change>`, regenerate the client with `npm run prisma:generate` (Prisma 7's `migrate dev` no longer does this) and commit the migration folder. `npm run db:status` compares a database with the migration history. `.gitattributes` keeps LF line endings because Prisma checksums each `migration.sql`.

## Data attribution

Weather and geocoding data come from [Open-Meteo](https://open-meteo.com/) ([forecast](https://open-meteo.com/en/docs), [marine](https://open-meteo.com/en/docs/marine-weather-api) and [geocoding](https://open-meteo.com/en/docs/geocoding-api) APIs) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Every forecast response repeats this in `attribution`. The free API is for non-commercial use.

## Project documents

- [Engineering notes](docs/engineering-notes.md): dated decisions, AI involvement, changes of mind and scope cuts.
- [Architecture decision records](docs/adr/README.md): accepted decisions and their rationale.
- [Design evidence](docs/design-evidence.md): the storage options and the marine-data spike that the ADRs cite, copied from the workspace.
- [Initial specification draft](docs/assessment-specifications.md): the first draft, kept for history and superseded where the decisions differ.
- [CLAUDE.md](CLAUDE.md) and [Claude skills](.claude/README.md): the instructions, task workflow, code-structure rule and `architect` agent used with Claude Code.

The finalized specifications, Technical Design and tickets were kept in the author's Notion and Linear workspaces. Links to them may require access, so the ADRs, the design evidence and the engineering notes are written to stand on their own. Each ADR lists the files in this repository that carry its decision before any workspace link, and each ticket in the engineering notes links its pull request.
