# ADR 0005 Use deterministic activity scoring v1

**Status** Accepted

## Context

The brief asks for a ranking and supplies no formula. The Technical Design chooses illustrative weather-suitability heuristics for a generic recreational visitor. Indoor sightseeing measures the appeal of an indoor alternative given outdoor conditions.

## Decision

Use exact location-local samples for the 09:00–18:00 window. Use instantaneous fields at 09:00 through 17:00 inclusive. Sum precipitation entries from 10:00 through 18:00 inclusive because each entry covers the preceding hour. Require nine finite measurements for each field an activity uses. Accept measured zero. Treat negative values for snow, precipitation, wind, wave height and period as missing. A missing or ambiguous required local timestamp fails the source coverage check.

Use mean temperature and snow depth, total precipitation, maximum 10 m wind and median wave height and period. Interpolate component scores linearly between breakpoints and clamp to endpoint scores outside the range.

| Activity | Scoring rule |
| --- | --- |
| Outdoor sightseeing | 50% temperature (0°C → 0, 20°C → 100, 35°C → 0), 30% precipitation (0 mm → 100, 8 mm → 0), 20% wind (10 km/h → 100, 40 km/h → 0) |
| Indoor sightseeing | 50 + 0.5 × (100 − unrounded outdoor score) |
| Skiing | With all inputs present, a mean snow depth of 0 m gives 0. Otherwise use 50% snow depth (0 m → 0, 0.3 m → 100), 30% temperature (−20°C → 0, −5°C → 100, 5°C → 0), 20% wind (10 km/h → 100, 45 km/h → 0) |
| Surfing | 50% wave height (0 m → 0, 1.2 m → 100, 3 m → 0), 30% wave period (4 s → 0, 12 s → 100), 20% atmospheric wind (10 km/h → 100, 40 km/h → 0). See [marine eligibility](0004-marine-data-eligibility.md). |

Check required sources, then measurements, then the surfing grid. Within each check, report the first failure with atmosphere before marine. Return `scoringVersion: v1` and explanations tied to actual inputs. Round final scores to the nearest integer with halves rounded up. Within each activity, order by descending rounded score and ascending date for ties, with sequential ranks from 1. Append unavailable dates in ascending date order with null score and rank.

## Consequences

The same input produces the same ranked dates. Weather snapshots can be used to recompute rankings after future scoring changes. Dry conditions at 20°C and 25 km/h produce 90 outdoors and 55 indoors. Treat the formula and its edge cases as part of the versioned contract.

In this repository: [Formulas](../../src/activity/activity-formula.logic.ts) · [Scoring and ranking](../../src/activity/activity-scoring.logic.ts) · [Unit tests](../../test/unit/activity)

Author's workspace (may need access): [Finalized ranking specification](https://app.notion.com/p/417a2e4a6cca81fda615c12d2ea79b4e) · [Technical Design](https://app.notion.com/p/417a2e4a6cca81949f4df8105ae4f9d8)
