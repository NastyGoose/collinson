# Collinson: seven-day activity weather ranking

A backend assessment service. Given a city or town, it ranks the next seven days for four activities: skiing, surfing, outdoor sightseeing and indoor sightseeing.

## Scope

- Node.js backend with a GraphQL API (NestJS).
- Weather from [Open-Meteo](https://open-meteo.com/), persisted in PostgreSQL (via Prisma) rather than fetched on every request.
- Deterministic, explainable scoring for each activity and date.
- Backend only. No frontend, accounts, booking, venue lookup or hosted deployment.

## Status

The repository baseline is set up. Application code begins with ARC-44 (bootstrap NestJS, PostgreSQL and Prisma). Setup, run and test commands, GraphQL examples, assumptions and Open-Meteo attribution will be documented here as those parts land.

## Project documents

- [CLAUDE.md](CLAUDE.md): instructions for Claude Code, sources of truth and implementation rules.
- [ADR index](docs/adr/README.md): accepted architecture decisions and their rationale.
- [Initial specification draft](docs/assessment-specifications.md): historical draft, superseded by the finalized specifications where they differ.
- [Claude skills](.claude/README.md): reusable task and PR workflow skills in `.claude/skills/`.
