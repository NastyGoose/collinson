# Collinson assessment — specification draft

Status: Draft for discussion. Prepared 13 November 2026.
Scope of this pass: requirements, feature specifications, preliminary technical direction, storage choices and delivery workflow. No implementation or external board has been created. Proposed defaults below are decisions to review, not employer requirements.

## 1. Source requirements

Read from `docs/reference/lead-snr-engineer-test-062026.docx` and the text elements and bound arrows in `docs/reference/task-composition-pitch.excalidraw`. These reference files are kept locally and excluded from version control.

| ID | Explicit assessment requirement | Covered by |
| --- | --- | --- |
| R1 | Accept a city or town | SPEC-01 |
| R2 | Rank the next seven days for skiing, surfing, outdoor sightseeing and indoor sightseeing | SPEC-03, SPEC-04 |
| R3 | Use Open-Meteo weather data | SPEC-02 |
| R4 | Persist weather rather than calling upstream on every request; decide modelling, storage and refresh | SPEC-02 |
| R5 | Node.js and GraphQL; storage is open | Technical direction, SPEC-04 |
| R6 | Backend only; no frontend | Scope boundary |
| R7 | Public GitHub repository and short README with run instructions and assumptions | SPEC-05 |
| R8 | Use AI and show authentic reasoning, decisions, assumptions and cuts | SPEC-05, working log |
| R9 | Notify the assessor when finished | Final submission task; not authorized for sending now |

User decision: NestJS for the backend. The brief values how the work happened ahead of the finished service, and explicitly favors focused reasoning over volume. It supplies no deadline, traffic target, hosting requirement, authentication requirement or scoring formula.

## 2. Delivery process adapted from Excalidraw

The diagram's product document template contains Problem, Motivation, Before/After, Requirements, Perspectives, and Happy/Sad paths. Each specification below follows that template, with acceptance examples added for later traceability.

The diagram separates Specification → Tech Design → Implementation Plan → [DEV] tickets. Specification, Tech Design and Implementation Plan all feed E2E Scenarios, which then feed [E2E] tickets. Documents are discussed asynchronously; implementation and test tickets are small, have precise criteria and follow one ticket per PR.

For this exercise, use one epic, **Seven-day activity weather ranking**, with five specification sections. Use one combined TD and one implementation plan to avoid unnecessary document overhead. Multi-team sub-stories and UI designs are unnecessary here.

Recommended mapping: Notion replaces Confluence; GitHub Issues and Projects replace Jira. Keep discussion next to the relevant Notion document. Keep execution status only on the issue board. Export milestone documentation into the repository so assessors can follow the work without a Notion account. During drafting Notion is canonical; repository copies are dated snapshots, not independently edited duplicates.

## 3. Open questions and proposed defaults

| Question for product | Proposed assumption | Consequence |
| --- | --- | --- |
| Rank days per activity, activities per day, or the entire week? | Rank seven dates independently for each of the four activities | Direct reading of “next 7 days … for each activity”; no cross-activity comparison |
| Does “next seven days” include today? | Tomorrow through the following six dates, in the location's timezone | Seven complete local dates; fetch eight days including today |
| Who is the score for? | Generic recreational visitor | Heuristics are illustrative, not personalized or safety guidance |
| What if city names are ambiguous? | Return candidates; require selection by stable location ID | Never silently pick a different city |
| Does skiing mean resort availability? | Weather suitability at the resolved coordinates only | No claims about lifts, slopes, terrain or mountain conditions outside that point |
| How is coastal proximity determined? | Provisional maximum 25 km between requested coordinates and returned marine grid point | A heuristic requiring a spike; it does not prove that the grid point is an accessible surf beach |
| How fresh must data be? | Six-hour freshness window; at most 24 hours old fallback | Explicit timestamps and stale status; current date coverage still required |
| Which database? | Recommend SQLite for this bounded single-instance exercise; PostgreSQL is the alternative | Selection remains open until TD |
| Must this be deployed? | Local reproducibility is enough | Deployment is optional unless the assessor requests it |

Before finalizing TD, verify eight-day marine coverage, null handling and returned coordinate behavior using representative coastal and inland locations. The marine documentation has inconsistent default descriptions, so explicitly set the horizon and test returned coverage. A response containing wave data is not by itself evidence of a nearby coast.

## 4. Feature specifications

### SPEC-01 — Resolve the intended location

**Problem:** City names may be misspelled, absent or shared by multiple places.

**Motivation:** A plausible ranking for the wrong city is worse than asking for clarification.

**Before / after:** A free-text place name becomes either one resolved geographic identity, a list of candidates, or an explicit not-found result.

**Requirements**

- Accept a trimmed city/town query of 2–120 characters. Support Unicode and an optional two-letter country filter.
- Use Open-Meteo geocoding. Expose up to five candidates with ID, name, country, administrative region when available, coordinates and timezone.
- Allow the ranking query to accept either a city query or a selected location ID, but never both or neither.
- If the bounded search returns multiple candidates, return an ambiguity result rather than ranking the first candidate. Users may refine the text or country filter.
- Persist resolved location identity. Repeated requests by stored ID must not require geocoding again.
- Cache identical normalized searches for a proposed 24 hours; cache genuine empty results for one hour. Never cache upstream failures as empty search results.
- Treat missing timezone or invalid coordinates as unusable upstream data, not as UTC or zero coordinates.

**Perspectives:** Caller knows what place was selected; maintainer has one canonical key for weather persistence.

**Happy / sad paths:** Unique match proceeds; multiple matches return candidates; absent match returns not found; malformed input is rejected before upstream access; provider outage is distinguished from an unknown town.

**Acceptance examples:** Whitespace-only input fails validation. Two different Springfield IDs never share a forecast entry. A stored location ID continues to work while geocoding is unavailable.

### SPEC-02 — Persist forecasts and control refresh

**Problem:** Calling the provider on every request is slow, fragile and explicitly disallowed by the brief.

**Motivation:** Reuse durable snapshots and make freshness observable.

**Before / after:** Forecasts are fetched only when needed and survive process restarts; callers can distinguish fresh, stale and unavailable data.

**Requirements**

- Fetch atmospheric and marine data through separate provider adapters. Explicitly request the necessary horizon, timezone and units.
- Persist validated forecast snapshots with location identity, source, requested and returned coordinates, units, timezone, UTC fetch timestamp, covered interval and schema version.
- Preserve sufficient hourly values to calculate local daytime summaries. Proposed activity window: local 09:00–18:00, using hours starting 09:00 through 17:00.
- Do not persist only computed activity scores: persisted weather must support recalculation when scoring rules change.
- Reuse a snapshot when its age is less than six hours and its coverage includes all requested dates. Age alone does not establish a cache hit.
- On a cache miss or expired/insufficient snapshot, perform a bounded refresh before responding. Coalesce concurrent refreshes for the same location and source in a single process.
- Apply a five-second timeout per upstream attempt, with at most one retry for transient network errors or 5xx responses. Do not retry validation errors; honor rate-limit retry timing without holding requests indefinitely.
- Replace each source snapshot atomically only after validation. Preserve the previous good snapshot if refresh fails.
- If refresh fails, allow a snapshot at most 24 hours old only when it still covers the requested dates. Mark it stale and include the failure warning. Otherwise mark the affected source unavailable.
- Track freshness independently for atmospheric and marine data. A marine failure must not discard usable atmospheric rankings.
- Use request-driven refresh for the MVP. Scheduled refresh and distributed locks are deferred until needed.

**Perspectives:** Caller sees useful results and their age; maintainer can reproduce rankings; provider receives fewer requests.

**Happy / sad paths:** Cold request fetches and persists; warm request reuses; restart reuses; stale refresh failure uses bounded fallback; unavailable fallback produces an explicit failure; invalid payload never overwrites a good snapshot.

**Acceptance examples:** A second fresh request for a stored ID makes zero upstream calls. After restart the same remains true. Two simultaneous misses issue one fetch per required source. A snapshot fetched before local midnight refreshes if the new date range is not covered, regardless of its age.

### SPEC-03 — Explainable activity ranking

**Problem:** Weather fields do not directly express whether a date is a good choice for an activity.

**Motivation:** Produce predictable, explainable comparisons while acknowledging missing evidence.

**Before / after:** Validated weather becomes four independent lists of dated activity assessments, each with reasons and explicit data availability.

**Requirements**

- Always return entries for all four activities and all seven requested dates. Available dates have a numeric score from 0 to 100; unavailable dates have null score and rank plus a reason.
- Scores measure weather suitability under documented assumptions. They do not establish resort access, venue opening hours, surf safety or activity availability.
- Sort scored days by descending score; break ties by ascending date. Give scored days sequential ranks beginning at 1; append unavailable days in date order.
- Use deterministic rules, explicit metric units and a scoring version. No random or runtime LLM scoring.
- Attach at least one concise explanation drawn from the actual input values to every scored date.
- Never coerce missing measurements into zero. Missing required inputs make that activity/date unavailable; unrelated activities can remain available.
- For skiing, use ground snow, temperature and wind. Distinguish an actual zero snow measurement (poor suitability) from absent snow data (unknown).
- For surfing, require usable wave height, wave period and wind, plus the provisional marine-distance check. If distance exceeds the limit, report unsupported proximity rather than asserting no surfing exists nearby.
- Indoor sightseeing expresses how attractive an indoor alternative is given outdoor conditions. It is not a claim about museums or other venues.

**Provisional scoring policy for TD review**

| Activity | Inputs | Intended behavior |
| --- | --- | --- |
| Skiing | Daytime snow depth, temperature, maximum wind | Ground snow is essential; mild thaw and high wind reduce score |
| Surfing | Daytime wave height, wave period, maximum atmospheric wind | Favor moderate waves and longer periods; penalize high wind; disclose no beach orientation or swell-direction model |
| Outdoor sightseeing | Daytime temperature, precipitation, maximum wind | Favor comfortable, dry, calmer conditions |
| Indoor sightseeing | The same atmospheric inputs | Start from a positive baseline; favor indoors increasingly as outdoor conditions deteriorate |

Exact thresholds, weights, aggregation rules, minimum sample coverage and worked scores belong in TD before implementation. Proposed approach: simple piecewise component scores with weighted sums; indoor score can be a documented baseline plus an inverse outdoor-weather component. Do not imply meteorological validation of these heuristics.

**Perspectives:** Caller understands why one day ranks above another; reviewer can inspect and test the scoring behavior.

**Happy / sad paths:** Complete weather yields ranked dates; ties remain stable; missing marine measurements affect surfing only; missing snow measurements do not become fabricated ski conditions.

**Acceptance examples:** Identical inputs and scoring version produce identical output. Missing wave period yields null surfing score with a reason. Changing only temperature cannot change scores for a rule that does not use temperature. A rank tie always resolves to the earlier date.

### SPEC-04 — GraphQL consumer contract

**Problem:** Consumers need a stable way to search places and request results without understanding provider payloads.

**Motivation:** Satisfy the mandated interface while keeping weather acquisition and ranking independently testable.

**Before / after:** Callers use a documented GraphQL contract to resolve locations and read the seven-day assessment.

**Requirements**

- Expose a location search query and an activity-ranking query. Proposed names: `locations` and `activityForecast`.
- A successful ranking response includes resolved location, timezone, seven-day range, four activity groups, scores/ranks/status/reasons, scoring version, source attribution and per-source freshness metadata.
- Model ambiguity and not-found outcomes explicitly in the contract. Distinguish input validation, provider timeout, unavailable weather and internal storage failure.
- Make activity-level score and rank nullable to preserve useful partial results. Do not allow one missing marine value to null the full GraphQL response.
- Freeze the location-local date range at request start; do not mix date windows if midnight passes during a refresh.
- Reject conflicting or missing location selectors. Bound input length and result count. Use fixed provider URLs rather than accepting arbitrary upstream URLs.
- Keep raw provider payloads, stack traces and infrastructure details out of consumer errors.
- Publish example queries covering unique place, location selection, fresh data, stale data and partial availability.

**Perspectives:** Caller gets predictable typed outcomes; reviewer can exercise the backend without a frontend.

**Happy / sad paths:** Valid location returns results; ambiguous name returns selection options; one source fails with partial results; complete unavailability produces a documented outcome.

**Acceptance examples:** Every successful ranking response contains four groups with seven dates each. Returned dates belong to the resolved timezone. A marine timeout preserves available sightseeing scores and explains the missing surfing data.

### SPEC-05 — Reproducible delivery and visible reasoning

**Problem:** The assessor must understand both the implementation and how its decisions were made.

**Motivation:** Reasoning is the primary deliverable in the brief.

**Before / after:** A clean checkout can be run and tested, with an honest record of evolving decisions and cuts.

**Requirements**

- Deliver a public GitHub repository when implementation is complete. Repository creation/publication is a later step, not part of this specification pass.
- Provide a short README with prerequisites, exact install/run/test commands, database initialization, example GraphQL queries and key assumptions.
- Track concise dated working notes: question, chosen assumption, alternative considered, reason and resulting change. Preserve real changes of mind; do not fabricate a retrospective process.
- Record consequential AI assistance, including suggestions rejected or corrected. The current specification draft is AI-assisted planning, not implemented behavior.
- Use meaningful commits and link issues to PRs. Each code-change issue should map to one PR, as the supplied diagram specifies.
- Include deterministic unit tests for scoring and time boundaries, persistence integration tests, and GraphQL E2E tests with controlled provider fixtures.
- Run lint, type checking, unit/integration tests and fixture-based E2E in CI. An optional live-provider smoke test is manual and not a PR gate.
- Document provider attribution, limitations, omitted scope and known tradeoffs. Inspect repository contents before publication for credentials and unrelated personal information.

**Perspectives:** Assessor can reproduce behavior; author has a credible trail of engineering judgment.

**Happy / sad paths:** Fresh checkout works; missing configuration has clear guidance; offline fixture tests work; live provider failure does not make deterministic CI flaky.

**Acceptance examples:** Another machine can initialize storage and run the example query using the README. CI verifies cache reuse and stale behavior without internet access to Open-Meteo.

## 5. Preliminary technical direction — input to the future TD

One NestJS modular monolith, using TypeScript and GraphQL with the Nest Apollo integration. Proposed code-first schema with an exported schema artifact for review. This is a recommendation, not a requirement beyond NestJS, Node.js and GraphQL.

| Boundary | Responsibility |
| --- | --- |
| Locations | Input validation, geocoding adapter, identity and search cache |
| Forecasts | Provider adapters, normalization, durable snapshots, coverage and refresh policy |
| Activities | Pure scoring functions, explanations, deterministic ranking |
| GraphQL API | Resolver orchestration, public DTOs and error/partial-result mapping |
| Persistence | Repository implementations and migrations for the selected database |

Resolvers should not contain HTTP fetching or scoring formulas. Provider-specific arrays are converted to a small internal weather model. A clock is injectable for timezone, TTL and rollover tests. Do not add a generic plugin framework, event bus, microservices, queues or Redis for this scope.

Candidate data model: `Location`; `LocationSearchCache`; `ForecastSnapshot` keyed by location, source and request/schema variant. Snapshots retain fetch time, coverage, coordinates, units and normalized hourly data. Keep only the current good snapshot per key for the MVP. Compute scores on demand; historical forecast analysis is out of scope. TD will specify uniqueness, atomic replacement and payload validation.

## 6. Application storage options

These are engineering fit assessments, not benchmark results. Choose one durable primary database.

| Option | Fit | Tradeoff | Recommendation |
| --- | --- | --- | --- |
| SQLite file | Small local service, durable snapshots, simple review setup | Single-writer coordination and local file lifecycle need care; requires persistent disk | Default for this take-home |
| PostgreSQL | Relational location metadata with structured or JSONB snapshots | Database service and migrations add setup | Best alternative for a realistic multi-instance backend |
| MongoDB | Snapshot-shaped documents are natural | Another service and document validation strategy without a clear benefit here | Viable, not preferred |
| Redis as primary store | Expiring lookup-oriented data | Durability and eviction must be deliberately configured; adds an operational concern | Avoid as sole persistence for this task |
| JSON files | Tiny prototype with inspectable payloads | Must build atomicity, locking and indexing yourself | Inferior to SQLite for similar effort |
| Hosted PostgreSQL | Same model as PostgreSQL with managed infrastructure | External accounts, connectivity and provider-specific free-plan restrictions | Optional later; unnecessary for local assessment |

Recommendation: **SQLite if optimizing for a focused, easy-to-run submission; PostgreSQL if you want to demonstrate production-style persistence.** Either satisfies the brief. ORM/query builder choice follows the database decision in TD; it should not drive the product specification.

## 7. Document and ticket tooling

Checked official product pages on 13 November 2026. Free plans may change.

| Setup | Why use it | Constraint / tradeoff |
| --- | --- | --- |
| Notion + GitHub Projects/Issues | Recommended: readable collaborative docs plus issue/PR visibility in the required code host | Maintain links and dated doc exports; no separate ticket synchronization needed |
| GitHub Markdown + Projects/Issues | Lowest overhead and strongest version history | Document review is less convenient for nontechnical collaborators |
| Notion alone | Docs and a task database in one place | PR status needs manual linking or integration; repository evidence still required |
| Notion + Trello Free | Familiar visual Kanban with simple cards | Free: 10 collaborators and 10 boards per workspace; custom fields are paid |
| Notion + Linear Free | Good engineering issue workflow | Free: two teams and 250 issues; adds another system beyond the required GitHub repo |

Notion offers a free individual plan and task databases. Verify workspace member/block limits before expanding collaboration; do not assume every team configuration is unlimited.

Recommended Notion page tree: Project home; Source requirements; Specifications; Decisions and working log; Tech Design; Implementation Plan; E2E Scenarios. Only the first four need substantive content at this stage.

Board columns: Backlog, Ready, In progress, In review, Done. Use a Blocked label with a linked dependency rather than losing the item's current phase. Fields: document/ticket type, spec ID, priority, dependency, document URL and PR URL. Preserve prefixes [SPEC], [SPIKE], [TD], [IP], [DEV], [E2E]. A tracking epic links all documents; implementation/test issues sit under it.

## 8. Proposed backlog — planning only

These are future ticket candidates, not implementation-ready tickets. The supplied workflow requires TD and IP first; exact code areas and implementation criteria must come from those documents.

| Candidate | Output | Dependency |
| --- | --- | --- |
| [SPEC] Confirm interpretation and assumptions | Reviewed SPEC-01 through SPEC-05 | Current draft |
| [SPIKE] Validate marine coverage and location applicability | Coastal/inland examples, eight-day and null-behavior findings | Proposed scoring scope |
| [TD] Define contract, scoring and persistence | GraphQL SDL, exact scoring examples, data model, failure policy | Specs, spike, database choice |
| [IP] Map design to implementation | Concrete module/file changes and small PR boundaries | TD |
| [DEV] Bootstrap NestJS and GraphQL | Runnable service and configuration | IP |
| [DEV] Resolve locations | Search and stable identity behavior | Bootstrap |
| [DEV] Persist and refresh forecasts | Validated snapshots and cache lifecycle | Locations, selected database |
| [DEV] Score and rank activities | Tested deterministic scoring functions | TD scoring policy; can use fixtures |
| [DEV] Assemble GraphQL response | Public contract, partial outcomes and metadata | Forecasts, scoring |
| [E2E] Verify consumer and persistence scenarios | Numbered scenarios implemented as tests | API, scenario document |
| [DEV] Finalize reproducible submission | CI, README and documentation snapshots | Working vertical slice |

## 9. Draft QA scenarios

Final E2E scenarios will be derived from SPEC + TD + IP, per the diagram. Current candidate cases:

1. Seed a unique place response and a complete forecast fixture. Query by city. Assert location, local date range, four activities, stable ranks and explanations.
2. Repeat by stored ID within freshness TTL. Assert no provider calls. Restart the service using the same database and repeat the assertion.
3. Advance the fake clock beyond freshness TTL. Trigger a refresh failure. Assert stale metadata and valid fallback only within the maximum age and coverage rules.
4. Advance beyond maximum fallback age. Assert unavailable results rather than old data labelled fresh.
5. Use two ambiguous place candidates. Assert no forecast call until a location is selected.
6. Supply valid atmospheric data but missing marine data. Assert sightseeing remains available and surfing explains its unavailable score.
7. Cross location-local midnight and a DST transition. Assert seven distinct local calendar dates and no fixed-24-hour date arithmetic errors.
8. Send concurrent cold requests. Assert one fetch per source and no partially written snapshot.

## 10. Scope cuts and initial working log

Out of scope: frontend, accounts, authentication, bookings, resort/venue databases, beach discovery, personalized proficiency levels, real-time alerts, historical analytics, distributed workers and automatic deployment. A basic health endpoint can be included if useful, but is not a product requirement.

13 November 2026 — Read the assessment DOCX and parsed the Excalidraw elements and relationships. The diagram is a process model, not application architecture. Chose to produce specifications before code or detailed tickets. NestJS is user-selected. Database remains a proposal. Flagged ranking semantics, city ambiguity, timezone boundaries and activity applicability as explicit assumptions. Consulted official Open-Meteo documentation; marine horizon/default wording needs validation. No live API behavior has been tested, no database selected, and no external workspace or board changed.

## Sources

- Local assessment: `docs/reference/lead-snr-engineer-test-062026.docx` (not version-controlled).
- Local process diagram: `docs/reference/task-composition-pitch.excalidraw` (not version-controlled).
- Open-Meteo weather fields, timezone and horizon: https://open-meteo.com/en/docs
- Open-Meteo marine fields, horizon and grid selection: https://open-meteo.com/en/docs/marine-weather-api
- Open-Meteo geocoding: https://open-meteo.com/en/docs/geocoding-api
- NestJS GraphQL: https://docs.nestjs.com/graphql/quick-start
- SQLite intended use: https://www.sqlite.org/whentouse.html
- PostgreSQL JSON types: https://www.postgresql.org/docs/current/datatype-json.html
- GitHub Projects: https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects
- GitHub plans: https://docs.github.com/en/get-started/learning-about-github/githubs-plans
- Notion pricing: https://www.notion.com/pricing
- Trello pricing: https://trello.com/pricing
- Linear pricing: https://linear.app/pricing
