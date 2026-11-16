# ADR 0004 Require usable surfing measurements and a nearby model grid point

**Status** Accepted

## Context

ARC-43 ran four live Open-Meteo marine queries on 13 November 2026 at 20:05 UTC. Each used eight forecast days, sea grid preference, Unix time and the location timezone. Each response had 192 contiguous hourly timestamps and covered all seven target dates.

| Location | Returned grid offset | Wave height and period |
| --- | --- | --- |
| Peniche | 2.20 km | Complete |
| Gdańsk | 15.10 km | Complete |
| Warsaw | 3.11 km | Both arrays entirely null |
| Madrid | 4.63 km | Both arrays entirely null |

A nearby grid point and complete timeline can coexist with wholly missing wave data. All four points were within 25 km. This run covered four locations and provides no calibration for the exact cap or a case with usable wave data beyond it.

## Decision

Persist a structurally valid marine snapshot with required timestamp coverage even when all wave samples are null. Apply normal freshness rules to it. On each surfing date check required source availability first, then usable wave height, wave period and atmospheric wind samples, then grid eligibility. Validate both coordinate pairs, calculate haversine distance using a mean Earth radius of 6371.0088 km, and compare the unrounded distance with an inclusive 25 km cap. Use the corresponding typed day code for missing data, invalid grid coordinates or excessive distance.

## Consequences

The 25 km cap is a v1 model-offset assumption. Beach proximity, access and surf safety are outside the evidence the model provides. A fresh marine snapshot can yield unavailable surfing days while atmospheric activities remain usable. Use deterministic fixtures for all-null marine data, partial samples and the cutoff boundary.

In this repository: [ARC-43 observations and reproducible requests](../design-evidence.md#marine-coverage-arc-43-adr-0004) · [Wave-value check](../../src/activity/activity-samples.logic.ts) · [Grid check](../../src/activity/activity-marine-grid.logic.ts) · [25 km cap](../../src/activity/activity.constants.ts)

Author's workspace (may need access): [ARC-43 observations](https://app.notion.com/p/417a2e4a6cca818787d7f8bd779b2f08) · [Technical Design](https://app.notion.com/p/417a2e4a6cca81949f4df8105ae4f9d8)
