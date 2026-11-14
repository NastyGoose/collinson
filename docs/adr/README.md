# Architecture decision records

These records capture the accepted decisions from Collinson's finalized specifications, Technical Design and marine spike. Acceptance records the design choice. Implementation status lives in Linear. The original assessment sets the requirements, and the finalized specs and Technical Design define the project's chosen behavior.

| ADR | Decision | Assessment trace |
| --- | --- | --- |
| [0001](0001-nestjs-graphql-backend.md) | A single NestJS GraphQL backend with a typed contract | R1, R2, R5, R6 · SPEC-01, SPEC-04 |
| [0002](0002-postgresql-prisma-persistence.md) | PostgreSQL and Prisma for location identity and weather snapshots | R3, R4 · SPEC-01, SPEC-02 |
| [0003](0003-local-window-and-forecast-refresh.md) | Seven complete local dates with request-driven refresh | R2, R4 · SPEC-02, SPEC-04 |
| [0004](0004-marine-data-eligibility.md) | Surfing availability requires usable measurements and a bounded grid offset | R2, R3 · SPEC-02, SPEC-03 · ARC-43 |
| [0005](0005-deterministic-activity-scoring.md) | Versioned, deterministic activity scoring | R2 · SPEC-03 |

Record new architectural decisions with a status, context, decision, consequences and links to supporting evidence. If a decision is replaced, link both records. Keep acceptance criteria and delivery status in [Linear](https://linear.app/archiview/project/collinson-seven-day-activity-weather-ranking-68ff31c71b4c). The [finalized specifications](https://app.notion.com/p/417a2e4a6cca81c7b5a8ff5e9cb63aa8) and [Technical Design](https://app.notion.com/p/417a2e4a6cca81949f4df8105ae4f9d8) hold the detailed contract.
