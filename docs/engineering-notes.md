# Engineering notes

These are the dated working notes for the assessment. They record the questions that came up, the assumption chosen, the alternatives considered, what the AI contributed and where its suggestions were rejected or corrected. The entries are condensed from the notes kept while the work happened: the planning log, the per-ticket plan logs and review notes, the ADR amendments, the commits and the pull requests. Nothing was written after the fact to make the process look tidier.

## How the work was done

The author ran the project with Claude Code as the main pair. The AI drafted the specifications from the brief, wrote most of the code and tests, and reviewed its own pull requests. The author chose the framework, the database and the tracker, decided every scope question, approved or rejected the AI's proposals, and approved each merge.

The delivery flow came from the Excalidraw process diagram supplied with the brief:

1. Five specifications (SPEC-01 to SPEC-05) were written against the brief's requirements R1–R9 and reviewed.
2. A marine-data spike (ARC-43) tested Open-Meteo before the design was fixed.
3. The Technical Design set the GraphQL SDL, storage, refresh and scoring rules. The [ADRs](adr/README.md) record its main decisions.
4. An Implementation Plan split the work into seven tickets, ARC-44 to ARC-50, each delivered as one PR.

For every ticket the AI followed the [`implement-task`](../.claude/skills/implement-task/SKILL.md) skill. It scored the ticket and wrote a local plan with a decisions list and a log. It then implemented in small commits and ran parallel review sub-agents (spec, code and security, tests, docs). Their findings were triaged with the author before the PR was opened. Out-of-scope findings were never fixed silently: the author chose for each one between "implement now", "draft a ticket" and "drop".

## Working log

### 2026-11-13 — Specifications

- **Question:** what does "rank the next seven days for each activity" mean? **Assumption:** rank the seven dates separately within each activity, with no comparison across activities. **Alternative:** one ranking of activity-day pairs for the whole week. **Reason:** this is the most direct reading of the brief.
- **Question:** does "next seven days" include today? **Assumption:** tomorrow plus the six following dates, in the location's time zone, fixed at the start of the request. **Reason:** seven complete local days. A partial "today" would be compared against full days. The forecast request therefore asks for eight days.
- **Question:** who is the score for? **Assumption:** a generic recreational visitor, scored on weather suitability only. Skiing does not mean resort or lift availability, and surfing does not mean beach access. This set what the explanations are allowed to claim.
- **Question:** what happens with ambiguous place names? **Assumption:** return up to five candidates and let the caller pick one by stable ID. **Rejected:** silently picking one of the matches.
- **Question:** how fresh must the data be? **Assumption:** reuse a snapshot for six hours, and fall back to one up to 24 hours old when a refresh fails, as long as it covers the requested dates.
- **AI draft, changed by the author:** the first draft recommended SQLite as the simplest storage for a single-instance take-home and listed PostgreSQL as the alternative. The author chose **PostgreSQL with Prisma** ([ADR 0002](adr/0002-postgresql-prisma-persistence.md)). The draft is kept as [assessment-specifications.md](assessment-specifications.md).
- **AI draft, changed in the Technical Design:** the draft proposed code-first GraphQL with an exported schema. The Technical Design published the exact SDL instead, so the implementation went schema-first (see 2026-11-14).
- **Marine spike (ARC-43):** the first attempt to call the marine API was blocked by host resolution and browser access. A later browser run returned all four test locations. Inland Warsaw and Madrid got grid points within 5 km, a full set of timestamps and **wave arrays that were entirely null**. "The response has data" therefore does not mean "the place has surf". Surfing now needs usable wave values plus a grid point within 25 km. The four samples do not calibrate the 25 km cap, and [ADR 0004](adr/0004-marine-data-eligibility.md) records it as an assumption.

### 2026-11-14 — Baseline (ARC-44, [#1](https://github.com/NastyGoose/collinson/pull/1))

- Before pinning dependencies the AI checked the current npm releases. Nest 12 ships as ESM only. Apollo Server 5 needs graphql 16. The `prisma` `latest` tag pointed at a v8 release candidate, so Prisma 7.10.1 stable was pinned instead.
- **AI correction:** the AI first installed ESLint and plain Jest. After reading Nest 12's own TypeScript template it switched to oxlint and to Jest with `--experimental-vm-modules`, matching the framework's defaults.
- **Decision:** schema-first GraphQL, because the Technical Design publishes the SDL and code-first would turn the contract into a generated artefact. A `health` query was added as the smallest proof that the endpoint works.
- **Decision:** each integration or E2E run creates its own `collinson_test_*` database, applies the checked-in migrations and drops it afterwards. **Rejected:** `prisma migrate reset` on a fixed test database, which is destructive and shared between parallel runs.
- **Blocker:** the machine had no Docker. The AI tried to run a throwaway PostgreSQL binary from npm, and its permission guard blocked it. Database checks waited until the author installed Docker Desktop. The README flow then passed in the workspace and in a clean copy.
- **Found before committing:** Git on the machine checks files out with CRLF line endings, and Prisma checksums each `migration.sql`, so two platforms would disagree about the same migration. Nest's template `.gitattributes` (LF everywhere) was adopted and checked with a real clone.

### 2026-11-14 — Locations (ARC-45, [#2](https://github.com/NastyGoose/collinson/pull/2))

- **Decision:** a location ID that is not a positive integer returns `LocationNotFound` without a database read, rather than `BAD_USER_INPUT`. IDs are opaque to clients.
- **Decision:** the provider is asked for ten records and the first five valid, distinct ones are kept, so one bad record does not push a real fifth candidate out.
- **Review finding, fixed:** the normalized search text was used as the cache key, but the raw text was sent to the provider. Two spellings that share a key, such as one with the Kelvin sign `K`, could ask the provider different questions. The NFKC-lowercased text is now used for both.
- **Decision:** an expired search is not served during a geocoding outage. SPEC-01 does not ask for it, and querying by stored ID is the outage path.
- **AI review finding rejected:** a test reviewer called one normalization test "vacuous". The test literal did contain the combining character, so the test stayed, rewritten with an escape sequence to make that visible.
- **Triage, implemented now:** purging expired searches. Purging inside the save transaction was rejected because two saves of different expired keys could deadlock. It runs after the commit with `SKIP LOCKED` and removes up to 100 expired searches per uncached search.

### 2026-11-14 — Forecasts (ARC-46, [#3](https://github.com/NastyGoose/collinson/pull/3))

- **Decision:** coverage means exactly one timestamp at each required local hour (09:00–18:00 atmospheric, 09:00–17:00 marine) on all seven dates. It is checked separately from whether measurements are null.
- **Change of mind, recorded in [ADR 0003](adr/0003-local-window-and-forecast-refresh.md):** timeouts became retryable once, to match geocoding. The "follow-up refresh" for a waiter that joined a refresh for another date window now applies only when that refresh succeeded or failed on coverage. A rate limit or timeout is not fixed by asking again for a different window.
- **Review findings, fixed:** a race where a caller whose read predated a just-finished refresh would fetch again (the shared refresh now re-reads the row first), and a snapshot with a future `fetched_at` that counted as fresh.
- **Triage, implemented now:** one shared, bounded Open-Meteo request helper for geocoding and both forecast sources, with a 2 MiB response cap. A real-socket probe in self-review found that a 5xx error page over 2 MiB became a non-retried invalid payload. The status is now checked before the size cap.

### 2026-11-14 — Scoring (ARC-47, [#4](https://github.com/NastyGoose/collinson/pull/4))

- **Decision:** precipitation is summed from 10:00 to 18:00 because each Open-Meteo value covers the hour before its timestamp. The other fields use 09:00–17:00.
- **Decision:** before rounding half up, scores are trimmed to nine decimals, so a float error such as 89.4999999999 rounds as 89.5.
- **Review finding, fixed:** a near-ideal day whose losses rounded away to 100 was described as "every factor is ideal". The text now says "close to ideal" unless every factor really is ideal. A mean snow depth of 0.0011 m printed as `0.00 m`, so snow depth now has three decimals.
- **Kept after review:** atmospheric coverage is required over the whole 09:00–18:00 window, even for an activity that does not use precipitation.

### 2026-11-15 — GraphQL contract (ARC-48, [#5](https://github.com/NastyGoose/collinson/pull/5))

- **AI correction:** the first version rethrew domain errors as `GraphQLError` from the resolver. The first E2E run showed Nest logging every `BAD_USER_INPUT` as a server error with a stack. Mapping moved to an exception filter.
- **Review finding, fixed:** `formatError` let through any error that carried its own code. A probe showed a Prisma `P2002` passing through with its raw SQL message. Only documented and Apollo request codes are now passed through, and everything else becomes `INTERNAL_SERVER_ERROR` ([ADR 0001](adr/0001-nestjs-graphql-backend.md) amendment).
- **Live check:** the README example "Peniche, PT" turned out to be ambiguous (two candidates), so the example was changed.
- **Triage, drafted as tickets:** four follow-ups (stale and partial examples in the README, bounding Apollo's echo of invalid variables, stripping bidi characters from `LocationNotFound` messages, a fixed malformed-JSON message). The first was folded into ARC-50. The other three are listed under known gaps below.

### 2026-11-15 — Scenario matrix (ARC-49, [#6](https://github.com/NastyGoose/collinson/pull/6))

- Every Implementation Plan E2E scenario except reproducible delivery got a GraphQL test against a fake Open-Meteo: midnight and DST, cold, warm and restart reuse, stale fallback, invalid replacements, partial and failed sources. All passed on the first run.
- **Check on the tests:** to show the scenarios could catch real defects, five deliberate breaks were made in `src/` and then reverted. They were: the date window taken after location resolution, no follow-up refresh, no coalescing, an exclusive 24-hour limit, and sampling in UTC. Each one failed at least one scenario.
- **Review finding, fixed:** the PR description said "eight runs in a row", but only four of those runs were at the final commit. It was corrected to the runs that actually happened.

### 2026-11-15 — Submission readiness (ARC-50)

- **Decision:** a shorter README. The ticket-by-ticket status text was replaced by a four-step overview and a list of assumptions and limits, and the detail stays in the ADRs. SPEC-05 asks for a short README.
- **Decision:** the GraphQL examples are request files in `examples/`, so the README can be run as written in bash and PowerShell. The optional live smoke check (`npm run smoke:live`) sends the same files.
- **Live check:** "Madrid, ES" returned five candidates. It became the ambiguity example, and its stored ID became the example of an inland city where surfing is unavailable.
- **Self-review finding, fixed:** on a fresh database the by-ID example returned `LocationNotFound`, because an ID resolves only after a search has stored it. The clean-checkout run had passed only because it sent the Madrid search first. The README now says to send it first, and the smoke script states the order and fails on any example file it has no check for. The same review found three README sentences that overstated the code (the 2 MiB cap, `extensions.field`, the purge size), plus the same 2 MiB slip in an ADR 0003 amendment.
- **Decision:** CI is one GitHub Actions job against a PostgreSQL service container. **Rejected:** one job per test tier, which would install dependencies three times for a small repository. The live smoke check is a manual workflow and never blocks a PR (SPEC-05).

### 2026-11-15 — Structure rules and architect (ARC-52)

- **Question:** after submission readiness, the author asked for the code to be split into more readable files. The requirements were: tests out of `src/`, types and constants in fixed, domain-named places, role postfixes on file names, and logging as a shared layer rather than a logger per class. **Decision:** write the target down and make it checkable first. The refactor itself, and documentation pages for the merged PRs, are separate tickets.
- **AI proposal, accepted:** [ADR 0006](adr/0006-module-layout-and-naming.md) uses singular domain folders, `<domain>.<role>.ts` names with a `.logic` role for pure functions, and `nestjs-pino` injected through a shared logger module. The author's own example used singular names (`forecast`, `activity`).
- **Question:** how should the rules be enforced? **Options:** (1) the ADR, a rule file and a read-only `architect` agent; (2) the same plus a mechanical check in CI. **The author chose 2.** dependency-cruiser checks imports in CI against a baseline of today's violations, so `main` stays green and only new violations fail. The baseline holds the 18 specs under `src/` and one spec that imports another module's clients. The architect covers what imports cannot show: file roles, mixed files and logger construction.
- **Review finding, before any code:** a sub-agent read the design as if it had to build it. It found two gaps. First, banning specs under `src/` in CI while Jest only read `src/` would leave new unit tests nowhere to go, so the Jest roots now include `test/unit/`. Second, activity scoring and the resolver use the forecast module's pure date window, which the new boundary rules would forbid. **Options:** a shared pure `src/calendar/` folder, or allowing pure-to-pure imports. **The author chose the calendar folder.**
- **Probe:** three deliberate violations were checked and each failed `lint:structure`: a new spec under `src/`, a type-only import of another module's repository, and `@nestjs/common` in activity code.
- **Architect dry run, three gaps fixed:** the first audit by the new agent found three gaps in the first rule set. First, the ban on importing another domain's `.logic` files would also have blocked the shared calendar. It would have left the resolver no allowed way to reach activity scoring, because pure code cannot offer a Nest service. The `.logic` files of `calendar` and `activity` are now their public API. Second, activity code could import another domain's service or repository unnoticed; a new `pure-no-io-domains` rule closes that. Third, `health` was configured as a domain although the ADR calls it infrastructure. A probe for each gap failed before the fix and passed after it.
- **Review findings, fixed:** a fresh-context review of the whole branch found that excluding `src/generated` from the scan also hid imports *of* the Prisma client from the purity rules. The folder is now only not followed. The self-review before merge found that a spec under `src/` with no imports slipped past the spec rule, so a rule for import-less specs was added. Both were probed before and after the fix. The same reviews corrected two ADR sentences that claimed more than the checker does.

### 2026-11-15 — PR documentation skills (ARC-53)

- **Question:** what should a reviewer get with every PR? **Decision (author):** two private pages written in plain language, linked from the PR. *Changes notes* say what changed, why, and what it affects. *Testing notes* say how each acceptance criterion was proven, with evidence. The readers are the author and the reviewer, not the assessor, so the pages are private artifacts rather than committed files.
- **Options:** (A) two new skills, with `changes-notes` replacing the existing `pr-walkthrough`; (B) two new skills next to `pr-walkthrough`; (C) one skill that publishes both pages. **The author chose A.** B would have kept two "what changed" pages that drift apart. C would rewrite the changes page every time tests were rerun. `changes-notes` keeps `pr-walkthrough`'s gathering and claim checks. Its criteria table and verify-by-hand steps moved to `testing-notes`.
- **AI proposal, accepted:** `testing-notes` gives each criterion one of four verdicts: proven, proven by hand only, partial, not proven. A verdict rests only on evidence the skill saw itself. A pending or red CI run is never "proven", and a manual check without an evidence file is "not proven". Log excerpts are trimmed and redacted, and screenshots are embedded in the page so it stands alone.
- **Hook-ins:** `self-review-pr` runs the ARC-52 architect in review mode, `implement-task` asks it where new files go, and `create-pr` points to the two notes skills.
- **Dry run, nine gaps fixed:** both skills were run on merged PRs and wrote their pages locally, unpublished. That was `changes-notes` and `testing-notes` on the ARC-50 PR, plus `testing-notes` on the ARC-44 PR with its task folder and ticket deliberately hidden. The runs gave honest verdicts: 3 of 6 criteria proven for ARC-50, and 0 of 8 for ARC-44, which predates CI. They also showed situations the skills did not cover:
  - docs and config deliverables, now proven by inspection;
  - bundled criteria, now split;
  - CI runs on a later commit;
  - a missing handoff or companion page;
  - inferences, now labelled.
- **Review findings, fixed:** a fresh-context review of the branch found five gaps, all fixed:
  - `--rerun` could test a checkout other than the PR head;
  - manual evidence older than later commits still counted;
  - a green job counted for a test it never ran;
  - redaction did not reach screenshots, headers or `changes-notes`;
  - the rules for combining a bundled criterion's verdicts contradicted the "partial" verdict.
- **First real use:** both skills published pages for their own PR, 3 of 4 criteria proven and 1 by hand only. The testing page itself pointed out that the dry runs predate the review fixes, so it did not count them as proof of the final text. The self-review before merge then closed five small gaps that had been deferred:
  - the page published second now adds its link to the companion page;
  - the log block takes keyboard focus;
  - the skills guide lists the new files;
  - `task-explainer` keeps one `artifacts.md` line per page;
  - two unwrapped lines are now wrapped.

### 2026-11-15 — Applying ADR 0006 (ARC-54, ARC-56)

- **Inventory:** the architect agent audited `main` in its own context and found 53 deviations: 50 medium and 3 low (naming only). All 100 baseline entries were import edges from the 18 specs under `src/`. The other findings were mixed files, role-less names, plural folders and per-class loggers.
- **Question:** one PR or several? **Decision (AI, under the ticket's own rule):** two subtickets under ARC-54. The layout ([ARC-56](https://linear.app/archiview/issue/ARC-56/dev-apply-the-adr-0006-module-layout-and-remove-the-structure-baseline)) changes no behaviour. The logger ([ARC-57](https://linear.app/archiview/issue/ARC-57/dev-use-the-shared-nestjs-pino-logger-by-injection)) adds a dependency and changes the log format, so it is verified on its own. The order is forced: editing a spec while it still sits under `src/` adds a new import edge to the baseline, so the specs move first and the logger follows.
- **Commits, each green:**
  1. move the specs and delete the baseline;
  2. extract `src/calendar/`;
  3. rename to singular folders and classes, and split files by role.
  Splitting files defeats git's rename detection, so the third commit is best reviewed on its own.
- **Choices the ADR left open:**
  - `isStorageFailure` goes to `prisma.errors.ts`. A `.logic` name would turn the repositories' import into a forbidden cross-folder one.
  - The scoring formulas become `activity-formula.logic.ts`, so `activity-scoring.logic.ts` stays the public entry point the ADR names.
  - `ScoringVersion` is a type, so `activity.types.ts` does not import the constants file, which would close a cycle.
  - `WEATHER_SOURCES` had no importer and was deleted.
  - Specs that tested both a client and its parser, or both the filter and the error formatter, were split along their existing `describe` blocks.
- **Check:** after the rename, a probe file for each rule (activity importing a forecast client, `@nestjs/common` or `node:fs`; calendar importing another folder; location importing forecast internals; infrastructure importing a domain; a spec under `src/`) made `lint:structure` fail with the expected rule names. Without that probe, rule regexes left on the old folder names would have passed silently. Test counts are unchanged: 320 unit, 43 integration and 35 E2E.

### 2026-11-15 — Shared logger (ARC-57)

- **Reviews of ARC-56 first:** before this part started, two sub-agents reviewed the layout PR.
  - The architect found 8 low findings, all fixed in that PR: wording, one misplaced type, the composition root, and a dead rule exemption.
  - A behaviour pass compared every top-level declaration and all 286 test cases with `main` and found no behaviour change.
- **Design:** `LoggerModule.forRoot()` wraps `nestjs-pino`. Every class that logs takes `@InjectPinoLogger(<Class>.name)`. `json-request` becomes `JsonRequestService`, which owns the retry and failure lines. The Open-Meteo clients still log their own parse failures.
- **Bug found on the way:** the first version configured nestjs-pino when the module file was imported. nestjs-pino creates a provider only for the `@InjectPinoLogger` contexts declared at that moment, so the app worked only because of import order. A spec that imported the logger module before `PrismaService` could not resolve its logger. The fix is the `forRoot()` call, which runs when a module graph is built.
- **Choices:**
  - Request access lines (`autoLogging`) are off. The ADR asks for structured logs of what the service does, not one line per GraphQL POST.
  - `forLog` became a public `JsonRequestService` method. A `.logic` file in `http` would be a forbidden cross-folder import, and a function exported from a service file would mix roles.
  - Tests are silenced by a Jest setup file that sets `LOG_LEVEL` from `TEST_LOG_LEVEL`, `silent` by default. Production code has no test detection. Unit specs build a real silent `PinoLogger` and spy on it, so the assertion on sanitized provider text needs no cast.
  - An invalid `LOG_LEVEL` fails startup like any other configuration key.
- **Architect review, 5 low findings fixed:**
  - The abstract forecast client no longer takes a logger parameter; each subclass injects its own.
  - `forLog` is static.
  - `HttpModule` stops exporting the now-internal `HTTP_FETCH`.
  - The `jsonRequest` test helper has its own file.
  - `DEFAULT_PORT` joined `DEFAULT_LOG_LEVEL` in `config.constants.ts`.

  Its optional suggestion was taken too: an oxlint rule now rejects `Logger` from `@nestjs/common` under `src/`, so that part of the ADR is checked mechanically.
- **Check:**
  - The built app logs JSON lines at `info` (every line of the startup log is JSON), and `LOG_LEVEL=warn` drops them.
  - `LOG_LEVEL=verbose` exits 1 and names the accepted values.
  - A test run with `TEST_LOG_LEVEL=warn` shows the retry and failure warnings under their class contexts.
  - A probe confirmed that `nestjs-pino` and `pino` imports from activity and calendar now fail `lint:structure`.
- **Self-review before merge, two gaps fixed:**
  - Integration and E2E runs were not reliably silent. Their global setup loads `.env`, so a `LOG_LEVEL` set there, or an empty one, reached the tests: an empty `LOG_LEVEL=` printed 24 lines in one spec. Tests now take only `TEST_LOG_LEVEL`, `silent` by default.
  - Every line logged during a GraphQL request carried the whole request, headers included, because pino-http binds it to the per-request logger even with access lines off. `quietReqLogger` keeps only the request id.
  - The same review found that `bufferLogs` does nothing in a Nest testing module, so the test apps no longer pass it.

### 2026-11-16 — GraphQL Tools advisory (ARC-58)

- **Finding:** `npm audit` reported one high advisory in the runtime tree. [GHSA-c4qx-w738-7hr3](https://github.com/advisories/GHSA-c4qx-w738-7hr3) is a prototype-pollution bug in `mergeIncrementalResult` that affects `@graphql-tools/utils` 10.10.1 to 12.0.1 and is fixed in 12.0.2. The lockfile held two copies. Apollo Server 5.5.2 brought in 12.0.1, the affected version, and `@nestjs/graphql` 14.2.1 brought in 12.1.0, which is patched. The application never calls `mergeIncrementalResult`, so the bug was a dependency exposure, not a demonstrated reachable path.
- **Constraint:** no supported upgrade existed. 5.5.2 is Apollo Server's latest release, and it is the release that added the cap. [apollographql/apollo-server#8232](https://github.com/apollographql/apollo-server/pull/8232) holds `@graphql-tools/merge` below 9.2.5, `schema` below 10.1.2 and `utils` below 12.0.2. Those versions depend on `@whatwg-node/promise-helpers` 2, which requires Node 22.15 or later, and the cap keeps fresh installs on Node 20 working. Apollo plans to lift the cap in v6, which drops Node 20. That work is still a draft ([#8233](https://github.com/apollographql/apollo-server/pull/8233)). This project requires Node 24 (`engines`, CI), so the reason for the cap does not apply here.
- **Decision:** a scoped npm `overrides` entry under `@apollo/server` sets `merge` 9.2.8, `schema` 10.1.5 and `utils` 12.1.0. These are the exact versions `@nestjs/graphql` already pins, so a single copy of each package remains. The app already ran these versions. Nest builds the schema with them and passes it to Apollo Server, so Apollo's own call to `makeExecutableSchema` never runs. **Rejected:**
  - downgrading to Apollo Server 5.5.1. Its published code is identical to 5.5.2's, and the cap is the only difference. But its open range (`schema` ^10.0.0) does not force a patched version. A trial install against the current lockfile kept `schema` 10.1.1 and `utils` 12.0.1. A later bump to 5.5.2 would also bring the cap back;
  - a global override, which is wider than needed;
  - waiting for v6, which would leave a high advisory in place before release.
- **Check:** after deleting `node_modules`, `npm ci` resolves one `@graphql-tools/utils`, at 12.1.0. `npm audit --omit=dev` reports 0 vulnerabilities. Format, lint, typecheck, `lint:structure`, build, unit (325), integration (43) and E2E (35) all pass. The built app answers the `health` example.
- **Residual:** three advisories, all in the Jest dev-only tree. They are GHSA-3g3m-2fjr-6pw4 in `glob` (moderate), GHSA-g3hv-75wg-m249 in `minimatch` (moderate) and GHSA-gcqx-w48m-w2h4 in `deepmerge` (low). `npm audit` counts them as 20 vulnerable packages. The suggested fix is a semver-major downgrade of Jest, so they are accepted for this submission. `npm ls --all` also flags `chokidar` under the dev-only `@nestjs/cli`. That predates this change and shows up on `main` too.
- **Removal:** delete the override once Apollo Server lifts the cap, or once `@nestjs/graphql` moves its own pins. Then run `npm ls @graphql-tools/utils` and `npm audit --omit=dev` again.

### 2026-11-16 — Request errors and introspection (ARC-59)

- **Probe first:** a throwaway E2E spec sent benign sentinel values to the running app. It confirmed three of the drafted ARC-48 follow-ups. Malformed JSON came back as Nest's default 400 with the V8 parser message, which can quote the body. Variable coercion errors quoted the submitted value, and `LocationNotFound` repeated the city. It also showed that the charset and content-encoding errors echo a request header, so the same filter covers them.
- **Decision:** a body that does not parse gets a GraphQL-shaped body with `BAD_REQUEST`, the code Apollo already uses for other malformed requests, so `/graphql` answers with one shape. **Rejected:** keeping Nest's `{statusCode, error, message}` shape with a fixed message, which would leave two error shapes on one endpoint.
- **Decision:** coercion errors are recognized by structure, a single variable-definition node and no path, which is the same test Apollo applies. They are not recognized by message text. The fixed message names the variable and its declared type from the query. No `field` is returned: graphql-js puts the path inside a variable only into the message string, and the spec rules out parsing it.
- **Decision:** `GRAPHQL_INTROSPECTION` makes introspection explicit. It defaults to `NODE_ENV !== 'production'`, which matches Apollo's own default, and the database test tiers pin it on. A production-mode E2E spec passes even without the setting, so a second spec turns introspection back on under `NODE_ENV=production` to show that the setting decides. That spec fails without the wiring.
- **Check on the tests:** with the global filter removed, 6 of its 9 unit cases failed. With the AppModule wiring reverted, 4 of the E2E boundary cases and the override spec failed. The built app was also probed in development and production mode over real HTTP.
- **Review findings, fixed:** the filter first returned a resolver's HttpException, which Nest reads as "handled", so it skipped Nest's log. It now returns nothing. The production introspection spec deleted `GRAPHQL_INTROSPECTION`, which let a developer's `.env` refill it, so it now sets it empty. The README and ADR claimed that no request text is echoed, which overstated the code: parse errors quote the query too.
- **Triage, implemented on the same branch:** the author chose to fix all four review follow-ups in ARC-59 rather than file tickets.
  - `CitySearch.label` was removed, since nothing read it once the messages were fixed.
  - Parse errors, validation errors on an input literal and an unknown `operationName` get fixed messages under their own codes. They are matched by code and by the literal's AST node kind, not by message text. Validation errors about names keep their message because they are useful for debugging, and a GraphQL name cannot carry arbitrary text.
  - graphql-js stops after 50 variable errors and adds one more with no code, which was masked as `INTERNAL_SERVER_ERROR`. It is now `BAD_USER_INPUT`. Its fixed text is the only way to recognize it.
  - Nest's route-not-found 404 repeated the path. The filter recognizes it by rebuilding Nest's exact message from the request, so a deliberate 404 from a future controller keeps its message. The filter is named `RequestErrorFilter` again, since it now covers more than request bodies.
  - Run against the previous mapper and filter, exactly the 7 new E2E cases failed.

## Scope cuts

- **Product:** no frontend, accounts, booking, resort, venue or beach lookup, personalized proficiency, historical analytics, alerts or hosted deployment. All were cut in the specifications.
- **Infrastructure:** refreshes are merged only within one process. Merging them across processes would need a lock or a queue, which was not needed for a single local instance. No background refresh worker: weather is refreshed when a request needs it.
- **Calibration:** the scoring formulas and the 25 km marine cap are illustrative v1 assumptions. They are versioned (`scoringVersion`) so they can change without breaking the stored snapshots.
- **Deferred hardening:** ARC-59 built the fixed malformed-JSON message and the fixed variable-error messages. It also made `LocationNotFound` messages fixed, which leaves no submitted text in them to strip. The follow-up work also fixed the messages of parse errors, validation errors on literals and an unknown `operationName`.
