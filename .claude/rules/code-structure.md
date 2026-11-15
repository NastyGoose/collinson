---
paths:
  - "src/**"
  - "test/**"
---

# Code structure

The short form of [ADR 0006](../../docs/adr/0006-module-layout-and-naming.md). Read the ADR for the reasons.

## Where files go

- One folder per domain, named in the singular: `location`, `forecast`, `activity`, `activity-forecast` (GraphQL entry point). Infrastructure: `clock`, `config`, `http`, `prisma`, `health`, `logger`.
- Pure local-time, date-window and coverage logic goes in `src/calendar/`.
- A domain's types, constants and errors live in its own folder, never in a global `types/` or `constants/` folder.
- Unit specs go in `test/unit/<folder>/<file>.spec.ts`, mirroring `src/`. Never add a spec under `src/`.

## File names

`<domain>[-<subject>].<role>.ts`, with one role per file:

- `.module`: Nest wiring only
- `.resolver`: GraphQL orchestration and mapping calls
- `.service`: injectable domain service
- `.repository`: Prisma access
- `.client`: provider adapter
- `.mapper`: pure shape mapping
- `.logic`: pure functions, with no dependency injection and no I/O
- `.types`: types and interfaces only
- `.constants`: values only
- `.errors`: error classes and codes
- `.filter`: Nest exception filters
- `.graphql`: SDL

## Keep apart

- A `.types` file has no runtime code. A `.constants` file has no functions or classes.
- Logic files import shared types and constants from the domain's `.types` and `.constants` files. Only a type or constant that no other file uses may stay in the logic file.

## Logging

- Inject the shared logger: `@InjectPinoLogger(<Class>.name) private readonly logger: PinoLogger`.
- Never write `new Logger(...)`, import `Logger` from `@nestjs/common`, or pass a logger as a function parameter.
- `.logic` and `.mapper` files never log.

## Module boundaries

`npm run lint:structure` checks these rules:

- `no-circular`: no circular imports.
- `activities-pure`, `activities-no-core`, `calendar-pure` and `calendar-no-core`: activity and calendar code import no infrastructure, framework or Node.js core code.
- `pure-no-io-domains`: activity code never imports another domain's `.module`, `.service`, `.repository` or `.client` files. Calendar code imports nothing else from `src/` at all.
- `no-upward-imports`: domains never import `activity-forecast` or `health`.
- `infrastructure-no-domain`: infrastructure, including `health` and `calendar`, never imports a domain.
- `no-domain-internals`: from another domain, import only its `.module`, `.service`, `.types`, `.constants` or `.errors` files. The `.logic` files of the pure `calendar` and `activity` folders are public and may be imported too. The checker enforces only the forbidden half: another domain's `.repository`, `.client`, `.logic` and `.mapper` files. Follow the rest yourself.
- `no-test-imports-in-src`: production code never imports from `test/`.
- `no-spec-in-src` and `no-spec-in-src-orphan`: no spec files under `src/`.

## Until the refactor lands

The existing files still use the old layout: plural folders, mixed files and `new Logger`. The refactor ticket migrates them. Until then:

- add no new deviation;
- put new unit specs in `test/unit/`;
- make sure `npm run lint:structure` passes (it has no list of known violations);
- when it is unclear where new code belongs, ask the `architect` agent in placement mode.
