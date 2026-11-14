---
name: implement-task
description: Implement a tracker task end-to-end from its link or key — score its complexity, gather the spec/docs/designs/tests it depends on, write a local plan with a work log, implement in one or several commits, then verify at a depth matched to the score and hand off a checklist of manual checks and actions. Use whenever the user hands over a ticket link, key or issue number (PROJ-123, #456) and wants it done, or says "implement/do/pick up/work on this task".
user-invocable: true
argument-hint: "<task-url-or-key> [--resume]"
---

# Implement a task

Input: a ticket URL, key or issue number from the project's tracker (`PROJ-123`, `#456`, a Jira, Linear or GitHub
Issues link). Extract the key; it is the identifier for everything below (branch, commits, plan file). For a bare
issue number use the number as the key.

Seven phases, always in this order. Phase 1 decides how heavy phases 2 to 6 are — never skip it, and never redo it
once the plan file records a score.

**Project specifics come from the project, not from this skill.** Commands (build, typecheck, lint, test tiers,
local stack), the tracker and how to reach it, branch and commit conventions, rule files, doc locations and who owns
scope are read from the repo: `CLAUDE.md` / `AGENTS.md`, the README, contribution docs, package scripts or the
Makefile, and CI config. Where the repo states a convention, it wins over the defaults below. Where it is silent,
discover it (how recent branches, commits and PRs look) or ask once, and record the answer under `## Decisions`.
`main` below means the repo's default branch.

**Resume first.** If `.claude-tmp/tasks/<KEY>/<KEY>.md` already exists (or `--resume` is passed), read it, read
the `## Log`, and continue from the first unchecked task in `## Tasks`. Do not re-fetch sources or re-score unless the
ticket changed since the `fetched` timestamp in the plan header.

**Scope is the ticket.** Implement only what the task's description and acceptance criteria ask for. Anything else
you find along the way — a neighbouring naming gap, a rule the surrounding code breaks, a refactor that would help,
a reviewer finding about code the task does not need to change — is a **follow-up**, not a task: record it under
`## Follow-ups` in the handoff with enough detail to act on, and put it to the user in the triage step before the
final report. This holds even when a criterion says to _review_ something: report what the review finds and change
only what the ticket names. A change is in scope only when the ticket requires it or the in-scope change cannot
compile, pass its tests or stay consistent without it — say which in `## Decisions`. When unsure, it is a follow-up.

**The diff itself is not a follow-up.** Files the change adds or rewrites meet every project rule in full, even when
their content was copied from old code. A wrong comment or docstring on a line the diff already touches is fixed in
place. That is the quality of the diff, not extra scope.

**Scope is what the ticket asks, not which layer it names.** A backend ticket may change the frontend, and a frontend
ticket may change the backend, whenever that is the cheapest way to meet a criterion or to answer a question the
ticket leaves open. Never pick a costlier fix because the ticket was written against one side.

**Never file tickets on your own.** New tickets and scope calls belong to whoever owns scope on the project (product
owner, PM, the ticket's reporter — the **scope owner** below); technical scope questions go to the **technical
lead**. Unless the project's instructions say the agent may file tickets, the most you do is draft a ticket
description for the user to take to them.

## Phase 1 — Score

Fetch the task from the tracker with whatever the session has for it: the tracker's MCP tools (load them with
`ToolSearch`), or a CLI such as `gh issue view`. If the tool is not authenticated, ask the user to authenticate or to
paste the task text, then continue. Read the title, description, acceptance criteria, linked issues, attachments and
every link in the body.

Assign one of three scores. Pick the highest tier that any single criterion hits.

| Score | Any of these holds                                                                                                                                                                                                                                               |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** | One module or package, no schema/contract/migration change, no new screen or component, no design link, existing tests cover the area, acceptance criteria are self-explanatory. Typical: a bug fix, a copy change, a small tweak.                               |
| **M** | Two modules or layers (shared code + backend, or backend + frontend), or a schema / DTO / event contract change, or a new component inside an existing screen, or a design link, or a migration. Fits in 2 to 4 commits.                                         |
| **L** | Three or more modules, a new module/route/screen, a new integration or external contract, an edge of a core domain lifecycle, a linked spec or tech design that the task depends on, or unclear acceptance criteria. Needs decomposition into reviewable steps. |

What the score controls:

| Aspect       | S                                                | M                                              | L                                                                                 |
| ------------ | ------------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| Plan doc     | Header + 1 task + log                            | Header + sources + 2 to 4 tasks + log          | Full template: sources, decisions, ordered tasks with deps, log                   |
| Sources      | Task text, tests in the touched area             | + linked docs, designs, repo docs for the area | + spec/tech design, ADRs, domain lifecycle docs, related closed issues, glossary  |
| Commits      | One                                              | One per task                                   | One per task; a task is done only when its tests pass                             |
| Verification | Self-check against the task + unit tests + rules | + integration tests + one spec-comparison pass | + parallel sub-agents: spec, design, rules, docs, tests (see Phase 5)             |

If the score is unclear, pick the higher tier. Write the score and a two-line rationale into the plan header; it is
the contract for the rest of the run.

**Unclear scope stops the run.** Read the issue's change history and comments, not only its current text. Stop
before Phase 2 when any of these holds:

- an acceptance criterion is vague or unmeasurable ("all names are aligned to the naming standard");
- a criterion cannot be fully met as written, for example because the work it needs was split out;
- the ticket was rewritten or split, and no ticket exists for the part that was removed.

Draft the open questions for the user: scope questions addressed to the scope owner, technical ones to the technical
lead, each with the options you see. Do not settle the scope yourself. Record the questions and the answers under
`## Decisions`, and continue only once the user brings the answers back or tells you to go on.

## Phase 2 — Gather

Collect only what the score column above asks for. Save references (paths, URLs, page titles), not copies.

1. **Task requirements** — restate acceptance criteria as a checklist. If the task has none, derive them from the
   description and mark them `(derived)` so the reviewer knows they are an interpretation.
2. **Documentation** — follow every link in the task; wiki or spec pages come through the same tracker/wiki tools.
   Repo docs: start from the root `CLAUDE.md` / `AGENTS.md` / README and whatever map of the docs they give, then the
   docs of each module the task touches. Read the project's glossary and domain or lifecycle docs before assuming
   state names.
3. **Designs** — for a design link (Figma or similar), load the design tool's MCP tools via `ToolSearch` and pull the
   referenced frames: node names, copy, states (empty, loading, error), and any redlines. Record the frame URLs and
   the user-facing strings (the translation keys, if the project localises).
4. **Codebase anchors** — the modules, schemas, services, hooks and routes the change lands in. Use the `Explore`
   agent for anything wider than a couple of files; you want paths, not file dumps. Trace the flow across layers: for
   each API path the ticket names, find the screens, dialogs and callers that reach it and read what they send and
   when; for a UI ticket, read the endpoints and services behind it. The cheapest fix is often on the other side: a
   "nothing changed" check in a form can remove a problem the backend would need a whole mechanism to absorb.
5. **Tests** — find the specs already covering the area, by tier (unit, integration, end-to-end; follow the
   project's testing conventions). Classify each as _run to verify_ (regression guard), _extend_ (add a case for the
   new behaviour), or _pattern to copy_ (new spec follows it). Note the exact command to run them, including the
   filtered form for a single spec.
6. **Rules in play** — list which of the project's rule and convention files apply to the paths you will touch
   (`.claude/rules/**`, lint config, style guides, ADRs). They apply at write time.
7. **Options across layers** — for each question the ticket leaves open and each behaviour choice that is not
   obvious, list the options at every layer before picking one: UI (form state, a disabled button, a confirm
   dialog), API (service, DTO, guard) and consumer or background job. Give each its cost and what it covers. Record
   the pick and the rejected options under `## Decisions`.

For **L**, also run the `Plan` agent on the gathered material to propose the task split, then edit it yourself. For
**S**, this whole phase is a few minutes; do not inflate it.

## Phase 3 — Plan file

Branch from `main` first, named the way the project names branches; default `git checkout -b <KEY>-<short-slug>`.

Write `.claude-tmp/tasks/<KEY>/<KEY>.md`, named by the key exactly as the tracker shows it, e.g.
`.claude-tmp/tasks/PROJ-123/PROJ-123.md`. The task folder is local working space and must never reach a commit or
the PR: check that `.claude-tmp/` is ignored (`git check-ignore -q .claude-tmp`), and if it is not, add
`/.claude-tmp/` to `.git/info/exclude` rather than to the tracked `.gitignore`. Never `git add -f` anything under
it, and never write task notes into the repo's tracked docs.

Template — drop sections the score does not need, never drop `## Log`:

```markdown
# <KEY> — <task title>

- Task: <ticket url>
- Score: S | M | L — <two-line rationale>
- Branch: <branch name>
- Fetched: <ISO timestamp of the ticket read>

## Requirements

- [ ] <acceptance criterion 1>
- [ ] <criterion 2> (derived)

## Sources

- Spec / tech design: <url or path> — <one line on what it decides>
- Design: <design url> — frames: <names>
- Repo docs: <path> — <why it matters here>
- Code anchors: <path>:<symbol> — <role>
- Tests: <path> — run | extend | copy — `<command>`
- Rules: <rule and convention files>

## Decisions

- <choice made where the sources were silent or conflicting, the options weighed at each layer (UI, API,
  consumer), and why>

## Tasks

### T1 — <name> (depends on: —)

- Goal: <one sentence>
- Files: <paths to create/change>
- Tests: <specs to add/extend and the command>
- Done when: <observable condition>

### T2 — ...

## Log

- <date> — T1 done — <what changed, test results, deviations from plan, anything the reviewer should know>
```

Rules for the file:

- Each task is one commit's worth of work and independently reviewable. Order tasks so every commit leaves the tree
  green (shared schemas and contracts first, then their producers, then their consumers).
- `## Log` gets an entry for every completed task, right after its commit and before the next task starts, with
  the commit sha. Tick the task's `## Requirements` lines at the same time. A resumed session relies on the log,
  so record deviations there, not in your head.
- Keep it to references and decisions. Do not paste spec text or code into it, and no secrets or tokens. Local
  setup notes (ports, machine-specific workarounds) are fine here — the file stays on this machine.
- Wrap at 120 characters; nothing formats it, since it is never committed.

Tell the user the plan's path once it is written, so they can review the score, the split and the decisions before
the first line of code lands.

For **S** the whole file may be under twenty lines. That is correct.

## Phase 4 — Implement

1. Work the tasks in order on the branch created in Phase 3. Before each one re-read its `Sources` lines and the
   rules for the paths you will touch. Apply the rules as you write; do not wait for a check to flag them.
2. Tests belong to the task, not to a later sweep: extend the `extend` specs, write the new ones following the
   `copy` pattern, and run the `run` set for the task before committing. When the tier of a new spec is not obvious,
   follow the project's testing conventions (or its test-writing skill, if it has one).
3. Commit the code and tests in the project's commit style (default `<KEY>: <imperative summary>`) plus the
   attribution trailer the session requires, then append the task's `## Log` entry with the sha and tick its
   requirements. For **S** this is a single commit. Never stage anything under `.claude-tmp/`.
4. Do not run the formatter, linter and typecheck after every edit when commit or push hooks already cover them. Run
   the typecheck or build once before Phase 5.
5. If a task turns out larger than planned, split it in the plan file and note why in `## Log`; do not silently
   grow a commit. If a requirement cannot be met as written, record it under `## Decisions`, finish everything else,
   and report it at the end. Never add a task mid-run for work the ticket does not ask for; log the finding and
   carry it to the handoff's `## Follow-ups` (see "Scope is the ticket"). It joins the plan only when the user picks
   "implement now" in the triage step.

Stop at commits. Do not push or open a PR unless the user asked or the project's instructions say the agent does;
then use `create-pr`.

## Phase 5 — Verify

Always, for every score:

- Walk `## Requirements` and tick each line with evidence (a test name, a screenshot, a manual step). Anything
  unticked is reported, not hidden.
- Run the full unit tier of every touched module and the `run`/`extend` specs from the plan. Paste failures
  verbatim in the report.
- **User-facing changes are exercised for real.** When the diff changes anything a user sees or drives (a screen, a
  CLI, a game view), run the app from the branch locally and drive every changed surface, as `verify-handoff` does:
  the new behaviour, its edge states (an undone edit, an empty list, an error) and one regression path through the
  old behaviour. Save screenshots or output under `.claude-tmp/tasks/<KEY>/evidence/`. Automated UI specs do not
  replace this; do it for every score. If the app lands on a login page, stop without a snapshot and ask the user to
  log in (`verify-handoff` §3).
- **Rules compliance** on the changed files: re-read them against the rule files listed in the plan (or run the
  project's rules-check skill, if it has one). In specs the diff adds, check in particular: no further copy of an
  existing test helper (extract one shared helper), no casts that silence the type checker where a narrow one works,
  and test titles in the project's style.
- **Docs the diff makes wrong.** Grep ADRs, docs, READMEs and script docblocks for every name, key and behaviour
  you changed. Fix each statement that is no longer true: a setting called optional that is now required, a
  migration called done while the old path still runs, a script docblock describing a run that cannot succeed.
  When an ADR or spec records its amendments, the amendment names every section the edit touches.

Add by score:

| Score | Additional checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** | Nothing more. Read the diff once against the task text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **M** | Integration tier for touched modules (on the local stack). One code-review pass (the project's reviewer skill or agent, otherwise `/code-review`). If a design link exists, one comparison of the rendered UI against the frames (use the `run` skill to drive the app).                                                                                                                                                                                                                                                                                                       |
| **L** | Everything in M, plus parallel sub-agents launched in one message, each given the plan file and the diff: (a) **spec** — every clause of the spec/tech design vs. the diff, report gaps; (b) **design** — frames vs. rendered screens, states included; (c) **docs** — statements the diff makes wrong and docs the change should have added; (d) **tests** — coverage of each requirement by tier, name the missing specs; (e) **security review** when the task touches auth, tenancy, uploads or external calls. Merge their findings, fix what is real and in the ticket's scope or in the diff itself, re-run the affected specs; findings outside it go to `## Follow-ups` for triage. |

End-to-end: if an automated end-to-end spec covers the flow, run it for **M** and **L**; for **S** only when the
changed area has one. Never leave a check as a manual step where an automated spec is possible.

## Phase 6 — Handoff

Write `.claude-tmp/tasks/<KEY>/<KEY>.handoff.md` beside the plan: the user's own checklist for everything the
automated run could not do or prove. It is a post-mortem written for the person who ships the change, not a
summary of the work — every line is something they check, do or decide. Same content rules as the plan file.

Build it from evidence, not from memory: unticked `## Requirements`, `## Decisions`, reviewer findings left unfixed,
failures that were classified pre-existing, and anything in the diff that reaches outside the repo. Walk this list
and include every item that applies:

- **Cross-repo / infra** — changes in a companion repo (infrastructure, queues, config, secrets), a new required
  environment key, anything that must be applied before or together with the deploy.
- **Data** — migrations, backfills, seed or fixture changes, data an environment needs before the feature works.
- **Contracts** — changed wire types, DTOs, event schemas, external API calls; who consumes them outside this repo.
- **Observability** — renamed log fields or component ids, new or affected monitors, dashboards, saved queries.
- **UI** — screens to click through, states to see (empty, loading, error), design frames to compare, new strings.
- **Uncovered paths** — anything only a human can drive (a third-party login, visual fidelity, a real vendor
  sandbox), and each requirement whose evidence is weaker than a test.
- **Process** — PR, ticket transition, notifying the owning team, follow-ups for scope left out and for every
  out-of-scope finding from the run, including a removal home for anything temporary the change leaves behind
  (transitional queues, temporary config keys, feature flags).

**Rollout rules.** The rollout is copied into the PR's deploy notes, where reviewers read it. Write it so it holds up
there. A change with no deploy (a library, a local tool, a prototype) says so in one line and skips the rest.

**Design the rollback first, and prefer steps to manual work.** Before writing any rollout, answer for each deploy:
what does the build that keeps running (the old one during the roll, the previous one after a rollback) do with
everything the new build writes? If any answer is "strands it", "rejects it" or "needs a replay", change the plan,
not the notes. Split the change into releases where each one's predecessor reads everything it produces. For a
rename on the wire or in stored data that means three releases:

1. **expand:** read both names, keep writing the old one;
2. **switch:** write the new one;
3. **contract:** remove the old reader, then the old infrastructure.

A **new** message or record type follows the same idea in two releases: the reader first (no writer), then the
writers, merged only once production runs the reader. Otherwise a rollback lands on a build that cannot read what is
already in flight, and the failures it produces mix with real ones.

A change this repo depends on in another repo is gated on the fact that actually matters — "applied in every
environment this merge will reach" — not on a guess about deploy order. Find out how each repo reaches each
environment (automatic on merge, a promotion PR, a manual dispatch) and state the gate with the check inline.

Manual steps (SQL replays, hand re-publishes, queue redrives) are a last resort. When one is unavoidable, list it
under `## Decisions to confirm` with the step-by-step alternative it was weighed against.

- **Self-contained.** Every SQL statement, command and script the rollout runs is written out in full, in its
  current and rehearsed form. Never "the SQL is in the handoff": the handoff is local, and reviewers cannot see it.
  For a production data write, give the `WHERE`, run it in one transaction, and rewrite every field that carries the
  changed value; a strict schema rejects a half-rewritten row.
- **A real rollback.** For everything the new build produces (messages, rows, record types), say what the previous
  build does with it. For example: nothing reads it, so it waits until retention expires (give the number); an
  unknown type, so it fails after N attempts. A failure queue redriven while the old build still runs fails again.
  List the actual recovery options and their time window, such as rolling forward within the retention period, or
  re-publishing by hand in the old shape. "Check the failure queue again" is not a recovery. Rolling back one change
  means a revert PR rolled forward through each environment; redeploying the build an environment ran before reverts
  every change merged since that deploy, so give it only as a fallback that names what else it reverts, with the
  exact command and how to find the running version.
- **No overlapping deliveries.** When two manual steps can deliver the same item (an automatic replay and a manual
  re-publish), say they run one after the other and name the check that comes between them. Cite the idempotency
  code and what it treats as done; an in-progress state is not terminal.
- **Verified cross-repo sequencing.** Check each fact instead of guessing ("probably the next version"):
  - which release first contains the companion change (`git tag --contains <merge sha>`);
  - what each environment is pinned to today;
  - what else the version bump carries;
  - whether a deploy gate refuses every release to that environment until the companion change lands.

  Name who owns each promotion, so the order can be agreed with them.
- **Each release's rollback is clean.** State, per release, what a rollback lands on and why it strands nothing.
  Also state the gate before the next release, such as "the previous release is running in every environment".

Template — scale it by score: **S** is a few checkboxes under two headings, **L** uses all of it. Drop empty
sections.

```markdown
# <KEY> — handoff

- Plan: `.claude-tmp/tasks/<KEY>/<KEY>.md` · Branch: <branch> · Commits: <first sha>..<last sha>

## Verify by hand

- [ ] <what to check> — <how: command, URL, screen, query> — expect: <observable result>

## Do by hand

- [ ] <action only a human can take> — <where / who> — <before or after deploy>

## Rollout

1. <ordered deploy steps, including the cross-repo ones, each command or SQL written out in full>

- Rollback: <what the previous build does with what the new one produced> — <recovery options and time window> —
  <what cannot be undone>

## Risks

- <risk> — <likelihood / blast radius> — <mitigation or what to watch>

## Decisions to confirm

- <decision taken under an assumption> — <the alternative> — <why it was chosen>

## Follow-ups

- [ ] <out-of-scope finding or scope left out> — <where: paths, rule or ADR section> — <triage: pending | implement
      now | draft ticket | dropped>

## Automated coverage

- <tier / check> — <result> — <known pre-existing failures and why they are unrelated>
```

Each checkbox is concrete enough to act on without reading the diff: a command, a URL, a query or a named screen,
and the result that counts as passing.

## Phase 7 — Triage follow-ups

Skip this phase when `## Follow-ups` is empty. Otherwise list every follow-up to the user, one line each with where
it lives and why it matters. Let the user choose per item with `AskUserQuestion` (group items into `multiSelect`
questions where that fits):

- **Implement now** — add it to `## Tasks` as a new task marked "added in triage", run Phases 4 and 5 for it, and
  note the user's choice in `## Decisions`.
- **Draft ticket** — write a ticket description into `.claude-tmp/tasks/<KEY>/<KEY>.follow-ups.md`, for the user to
  take to the scope owner. Do not file it unless the project's instructions say the agent files tickets.
- **Drop** — remove it, with a one-line reason in `## Log`.

Record each choice on the item's handoff line. Draft template, one section per item:

```markdown
## <proposed ticket title>

- Why: <the problem, and what goes wrong if it is left>
- Where: <paths, ADR or rule sections, PR threads>
- Proposed scope: <what changes, and what explicitly does not>
- Acceptance criteria:
  - [ ] <observable condition>
- Related: <parent story, PRs, existing tickets>
- Open questions: <scope or priority calls for the scope owner; technical ones marked for the technical lead>
```

## Final report

Short, self-contained, in this order:

1. Score and branch, commits listed as `sha — <commit subject>`.
2. Requirements checklist with the evidence for each tick and every unticked line called out first.
3. Checks run and their outcome, failures verbatim.
4. Decisions and deviations from the plan file, then the follow-ups with their triage choice, and the path of
   `<KEY>.follow-ups.md` when drafts exist.
5. What is left: pushing, PR, anything blocked on the user — the top items from the handoff, with its path.
6. Next steps: `verify-handoff <KEY>` walks the handoff against the local stack and captures PR screenshots;
   `create-pr <KEY>` checks the diff for leaked task files (`task-cleanup`) and opens the PR.

Before writing the report, add a final `## Log` entry with the Phase 5 results and tick the remaining
requirements. Name the plan and handoff paths in the report so the user can open them.
