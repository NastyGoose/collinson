# Design evidence

The specifications, Technical Design and spike notes were written in the author's Notion workspace, which reviewers may not be able to open. This page copies the evidence that the [ADRs](adr/README.md) cite, so that each decision can be checked from the repository alone. The values are unchanged from the workspace pages; the wording is condensed.

## Storage options (SPEC-02, [ADR 0002](adr/0002-postgresql-prisma-persistence.md))

The brief leaves storage open. The first AI draft recommended SQLite. The author selected PostgreSQL with Prisma ([engineering notes](engineering-notes.md#2026-11-13--specifications)).

| Option | Fit | Trade-off | Outcome |
| --- | --- | --- | --- |
| SQLite file | Small local service, durable snapshots, simple review setup | Single-writer coordination and the file's lifecycle need care. Needs a persistent disk | Considered for the simpler setup |
| PostgreSQL | Relational location metadata next to JSONB snapshots | A database service and migrations add setup | **Selected**, with Prisma |
| MongoDB | Snapshot-shaped documents are natural | Another service and a document validation strategy, with no clear benefit here | Viable, not preferred |
| Redis as the only store | Expiring, lookup-oriented data | Durability and eviction must be configured deliberately | Avoided as the only store |
| JSON files | A tiny prototype with readable payloads | Atomic writes, locking and indexing must be built by hand | Worse than SQLite for similar effort |
| Hosted PostgreSQL | Same model, managed | External accounts, connectivity and free-plan limits | Not needed for a local assessment |

## Marine coverage (ARC-43, [ADR 0004](adr/0004-marine-data-eligibility.md))

Four live requests to the Open-Meteo Marine API on 13 November 2026 at 20:05 UTC. All four returned JSON.

### Reproduce

Each request uses `forecast_days=8`, `cell_selection=sea`, `timeformat=unixtime`, `hourly=wave_height,wave_period` and the location's IANA time zone. These are rolling forecasts, so a later run covers other dates and may return other values.

- [Peniche](https://marine-api.open-meteo.com/v1/marine?latitude=39.3558&longitude=-9.3811&timezone=Europe%2FLisbon&forecast_days=8&cell_selection=sea&hourly=wave_height,wave_period&timeformat=unixtime)
- [Gdańsk](https://marine-api.open-meteo.com/v1/marine?latitude=54.352&longitude=18.6466&timezone=Europe%2FWarsaw&forecast_days=8&cell_selection=sea&hourly=wave_height,wave_period&timeformat=unixtime)
- [Warsaw](https://marine-api.open-meteo.com/v1/marine?latitude=52.2297&longitude=21.0122&timezone=Europe%2FWarsaw&forecast_days=8&cell_selection=sea&hourly=wave_height,wave_period&timeformat=unixtime)
- [Madrid](https://marine-api.open-meteo.com/v1/marine?latitude=40.4168&longitude=-3.7038&timezone=Europe%2FMadrid&forecast_days=8&cell_selection=sea&hourly=wave_height,wave_period&timeformat=unixtime)

### Observations

| Location | Requested lat, lon | Returned lat, lon | Grid distance | Time zone | Local dates | Full target days |
| --- | --- | --- | --- | --- | --- | --- |
| Peniche | 39.3558, −9.3811 | 39.375, −9.374985 | 2.20 km | Europe/Lisbon | 2026-11-13 to 2026-11-20 | 7/7 |
| Gdańsk | 54.352, 18.6466 | 54.458336, 18.791672 | 15.10 km | Europe/Warsaw | 2026-11-13 to 2026-11-20 | 7/7 |
| Warsaw | 52.2297, 21.0122 | 52.208336, 21.041672 | 3.11 km | Europe/Warsaw | 2026-11-13 to 2026-11-20 | 7/7 |
| Madrid | 40.4168, −3.7038 | 40.458336, −3.7083282 | 4.63 km | Europe/Madrid | 2026-11-13 to 2026-11-20 | 7/7 |

| Location | Missing wave height, 8 days | Missing wave period, 8 days | Missing per target date, height / period | Missing per target date at 09:00–17:00, height / period |
| --- | --- | --- | --- | --- |
| Peniche | 0/192 | 0/192 | 0/24 · 0/24 | 0/9 · 0/9 |
| Gdańsk | 0/192 | 0/192 | 0/24 · 0/24 | 0/9 · 0/9 |
| Warsaw | 192/192 | 192/192 | 24/24 · 24/24 | 9/9 · 9/9 |
| Madrid | 192/192 | 192/192 | 24/24 · 24/24 | 9/9 · 9/9 |

Each target date from 2026-11-14 to 2026-11-20 had local hours 00:00–23:00. Each response had 192 contiguous hourly timestamps and two aligned 192-value arrays. Every missing value was an explicit JSON null. Units were metres and seconds. Peniche's Unix bounds were 1794528000–1795215600 with a UTC offset of 0 seconds. The other three had 1794524400–1795212000 and +3600 seconds. Dates were computed from each Unix timestamp in the returned IANA time zone, which matched the requested one in every response. Distances use haversine with a mean Earth radius of 6371.0088 km.

### What it shows

- Both coastal samples had complete wave data. Both inland samples returned a nearby grid point and a complete timeline with wave arrays that were entirely null. All four passed a 25 km distance check. Open-Meteo describes sea-cell selection as a preference.
- Wave availability and timestamp coverage are therefore separate checks, and missing marine values affect surfing only.
- The run supports keeping both coastal examples under a 25 km cap. It has no case with usable wave data beyond 25 km and does not calibrate the exact value. A grid point, even with finite wave values, says nothing about the distance to the coast, beach access or surf safety.
- One run on four locations. DST changes, near-threshold cases with usable data and later forecast runs were not tested here. The automated tests cover them with fixtures: the Lisbon DST changes and repeated forecast runs in [`forecast-scenarios.e2e-spec.ts`](../test/e2e/forecast-scenarios.e2e-spec.ts) and [`calendar.logic.spec.ts`](../test/unit/calendar/calendar.logic.spec.ts), and the 25 km boundary in [`activity-marine-grid.logic.spec.ts`](../test/unit/activity/activity-marine-grid.logic.spec.ts).

[Open-Meteo Marine API documentation](https://open-meteo.com/en/docs/marine-weather-api)
