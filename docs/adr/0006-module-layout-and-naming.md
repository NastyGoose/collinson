# ADR 0006 Use domain folders, role-named files, tests outside src and a shared logger

**Status** Accepted

## Context

The first implementation grew file by file. Unit specs sit next to the code, so `src/` mixes production code and tests. Several files combine types, constants and logic: `forecasts/forecasts.service.ts` defines the freshness limits and the result types next to the service, and `activities/scoring-v1.ts` holds its breakpoint tables, its input types and the scoring functions together. File names do not say what a file holds. Each class that logs constructs its own `Logger`, and `http/json-request.ts` takes a logger as a parameter. Readers have to open a file to find out whether it holds a type, a value or behaviour.

The local date window and the coverage check in `forecasts/forecast-window.ts` are pure functions used by three modules: the forecast service, activity scoring (which must stay free of I/O) and the GraphQL resolver.

This record fixes the target structure before the refactor that applies it, so that the refactor, reviews and new code follow one written rule set.

## Decision

**Domain folders.** Each domain lives in one folder named by the domain in the singular: `src/location/`, `src/forecast/`, `src/activity/`, and `src/activity-forecast/` for the GraphQL entry point. Infrastructure folders keep their names: `clock`, `config`, `http`, `prisma`, `health`, and a new `logger`. A domain's logic, types, constants and errors live in its own folder. A large domain may group files in subfolders such as `clients/`. Types and constants never go to a global `types/` or `constants/` folder.

**Shared calendar logic.** A pure folder `src/calendar/` holds local-time conversion, the seven-date window and the coverage check. `forecast`, `activity` and `activity-forecast` import it. It imports no domain, no Nest package and no I/O module.

**File names.** Files are named `<domain>[-<subject>].<role>.ts`:

| Role | Holds |
| --- | --- |
| `.module` | Nest module wiring only |
| `.resolver` | GraphQL resolver: orchestration and mapping calls only |
| `.service` | Injectable domain service |
| `.repository` | Prisma access for the domain |
| `.client` | Provider adapter, such as an Open-Meteo API |
| `.mapper` | Pure mapping between shapes, such as domain to GraphQL or provider to domain |
| `.logic` | Pure domain functions with no dependency injection and no I/O |
| `.types` | Types and interfaces only |
| `.constants` | Constant values only |
| `.errors` | Error classes and error codes |
| `.filter` | Nest exception filters |
| `.graphql` | Schema-first SDL |

Examples: `forecast.service.ts`, `forecast.constants.ts` for the freshness limits, `forecast.types.ts` for the source results, `open-meteo-marine.client.ts`, `activity-scoring.logic.ts` and `activity-scoring.constants.ts` for the breakpoint tables.

**Separation.** A `.types` file has no runtime code. A `.constants` file has no functions or classes. Logic files do not export types or constants that other files use; those come from the domain's `.types` and `.constants` files. A type or constant that only its own file uses may stay there.

**Tests.** No test code lives under `src/`. Unit specs live in `test/unit/<folder>/<file>.spec.ts` and mirror `src/`. `test/integration`, `test/e2e`, `test/fixtures` and `test/support` keep their roles.

**Logging.** A shared `src/logger/` module configures `nestjs-pino`: structured JSON, level from `LOG_LEVEL` with `info` as the default, and silent in tests unless a test opts in. Domain classes receive a logger by injection (`@InjectPinoLogger(<Class>.name)` with `PinoLogger`). They never construct one and never import `Logger` from `@nestjs/common`. Helpers that log become injectable, so `json-request` stops taking a logger parameter. Pure `.logic` and `.mapper` files never log.

**Module boundaries.**

- No circular dependencies.
- `activity` and `calendar` are pure. They import no `prisma`, `http`, `generated`, `logger`, `clock` or `config` code, no `@nestjs/*` or `@prisma/*` package and no Node.js core module. `calendar` imports nothing else from `src/`. `activity` never imports another domain's `.module`, `.service`, `.repository` or `.client` files; it may import that domain's `.types`, `.constants` and `.errors` files, and the calendar.
- Lower layers never import upward. `location`, `forecast` and `activity` never import `activity-forecast` or `health`. Infrastructure folders, including `health` and `calendar`, never import domain folders.
- A module may use another domain's `.module`, `.service`, `.types`, `.constants` and `.errors` files. It never imports another domain's `.repository`, `.client`, `.logic` or `.mapper` files. The exceptions are the pure `calendar` and `activity` folders: they cannot offer a Nest service, so their `.logic` files are their public API. The resolver calls `activity-scoring.logic.ts`, and every module may use the calendar's logic.
- Production code never imports from `test/`.

**Enforcement.** `npm run lint:structure` runs dependency-cruiser in CI with the boundary rules above, plus a rule that no `*.spec.ts` file lives under `src/`. It checks imports, not names or file contents. The `architect` Claude agent and code review cover file roles, the separation of types, constants and logic, and logger use. The short working form of these rules is `.claude/rules/code-structure.md`.

## Consequences

Readers find a domain's types and constants without opening its logic, and a file name says what the file holds. Activity scoring and the calendar stay testable without Nest or a database. Log lines become structured and share one configuration.

The code does not follow this record yet. A separate refactor ticket moves the files, renames the domain folders, adds `src/calendar/` and `src/logger/`, and installs `nestjs-pino`. Until it lands:

- `.dependency-cruiser-known-violations.json` lists the existing violations. CI fails only on new ones. The refactor empties and deletes the file.
- The checker's rules name today's folders: `locations`, `forecasts` and `activities`. The refactor renames them in the rules in the same change.
- The unit Jest config reads both `src` and `test/unit`, so new unit specs go to `test/unit/` already. The refactor drops `src`.
- Of the role names the cross-domain rule forbids, only `.repository`, `.client` and `activity-forecast.mapper.ts` exist today. The rule covers `.logic` files, and the other domains' mappers, once the refactor names files by role. Until then, role-less files such as `forecast-window.ts` pass the checker.

The refactor touches the import paths of every unit spec and the logger spies in tests. The README's layout section and CLAUDE.md change with it.

[ADR 0001](0001-nestjs-graphql-backend.md) · [ADR 0003](0003-local-window-and-forecast-refresh.md) · [ADR 0005](0005-deterministic-activity-scoring.md) · [ARC-52](https://linear.app/archiview/issue/ARC-52/dev-record-structure-rules-and-add-an-architect-agent-with-a-ci)
