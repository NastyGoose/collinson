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

## Scope cuts

- **Product:** no frontend, accounts, booking, resort, venue or beach lookup, personalized proficiency, historical analytics, alerts or hosted deployment. All were cut in the specifications.
- **Infrastructure:** refreshes are merged only within one process. Merging them across processes would need a lock or a queue, which was not needed for a single local instance. No background refresh worker: weather is refreshed when a request needs it.
- **Calibration:** the scoring formulas and the 25 km marine cap are illustrative v1 assumptions. They are versioned (`scoringVersion`) so they can change without breaking the stored snapshots.
- **Deferred hardening (drafted, not built):** bounding Apollo's echo of invalid variable values, stripping invisible format characters from `LocationNotFound` messages, and a fixed message for malformed JSON bodies. None of these leaks secrets.
