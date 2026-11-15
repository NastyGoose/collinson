---
name: self-review-pr
description: Use when a task's PR is about to go to human reviewers (or back to them after changes), when asked to "review it like a reviewer would", "pre-review", "self-review", "check the PR before I send it", or when a reviewer's notes arrived and the same problems should be caught on this or the next PR before anyone else sees them.
user-invocable: true
argument-hint: "[PR number | KEY] [--apply]"
---

# Self-review a PR

Review the PR the way a senior reviewer who owns production would, then act on what you find. Most real problems
sit outside the code: in the rollout, in docs the change makes wrong, and in a PR description that no longer
matches the branch. A rename can be clean line by line and still strand in-flight data on deploy.

Input: a PR number or task key (default: the current branch's PR). Invoking this skill allows read-only work and
writing the review notes file. Pushing, editing PR bodies, and posting to the tracker or chat each need the user's
go-ahead in the triage step, unless the project's instructions give the agent that authority. `--apply` means the
user has already said "fix what's in scope". Do not file tickets on your own: new tickets go through whoever owns
scope (the **scope owner**), and technical scope questions go to the **technical lead**.

Project specifics (commands, rule files, reviewer skills, how releases reach each environment) come from the repo's
`CLAUDE.md` / `AGENTS.md`, docs and CI config. `main` below is the repo's default branch.

## 1. Gather: facts, not memory

Work in a separate worktree at the PR head (`git worktree add ../<repo>-<key> <branch>`) so the user's checkout stays
untouched. Collect:

- The diff from the merge base (`git diff $(git merge-base HEAD origin/main)..HEAD`) and `git log` with every
  commit, including reverts.
- Whether the branch still merges cleanly with `origin/main` (`gh pr view --json mergeable`).
- The PR body and every companion PR it names (infrastructure and other repos), as they stand now.
- CI at the head (`gh pr checks`), and the head SHA the body claims to describe.
- The ticket through the tracker's tools: description, acceptance criteria, comments, and the **change history**
  (who rewrote the scope, when, and whether a split-out part got its own ticket).
- Infra facts the rollout depends on, where the change is deployed:
  - which release first contains the companion PR (`git tag --contains <merge sha>`);
  - each environment's pinned version;
  - open version-bump PRs and what else they carry;
  - deploy gates that refuse a release until something else lands;
  - retention and retry limits of any queue or store the rollout relies on.

## 2. Check: every area, every time

Run the project's own reviewer skills or agents in parallel sub-agents for breadth (code review, test review, rules
compliance, docs consistency — whatever the repo provides; otherwise one `/code-review` pass). If the repo has an
architect agent (for example `.claude/agents/architect.md`), run it in review mode on the PR as one of them. Put its
structure and module-boundary findings into the notes like any other area's. Then do the areas below yourself. The
sub-agents don't cover them. Areas A to C apply to deployed software; for a change with nothing to deploy, say so in
the notes and skip them.

**A. Rollout design: rollback first.** For each deploy, look at two moments: the roll (old and new builds run
together) and a rollback (the previous build runs again). For everything the new build writes (message types,
queued work, stored rows, config keys, DB columns), answer: what does the other build do with it?

- If any answer is "strands it", "rejects it", "drops it after retention", or "needs a replay, a re-publish or a
  redrive", the finding is **the design**, not the notes. Propose step-by-step releases where each predecessor reads
  everything the next one produces. For a rename on the wire or in stored data:
  1. **expand:** read both names, keep writing the old one;
  2. **switch:** write the new name;
  3. **contract:** remove the old reader, then the old infrastructure.
- Redriving a failure queue while the old build still runs just fails the messages again. "Check the failure queue
  again" recovers nothing.

**B. Manual steps that remain.** Only after A, and only if the user keeps them:

- every SQL statement or command is inline in the PR in its rehearsed form, never "in the handoff";
- a production write rewrites every field a strict schema checks, not only the obvious one;
- steps that can deliver the same item twice run one after the other, with a named check between them (read the
  idempotency code: which states count as terminal; an in-progress state does not);
- each step has a deadline where retention drops data silently.

**C. Cross-repo facts.** Check every claim in both PR bodies against step 1: versions ("probably the next one" is a
finding), environment pins, what gates block and for whom, and "check X fails" statements against real CI.
Anything temporary (transitional queues, temporary config keys, feature flags) needs a named removal plan.

**D. Docs the PR makes wrong.** Build this table in the notes before writing any D item. It is required, even when
every row ends up "still true":

| Changed thing | Change | Every doc hit (`path:line`) | Still true? |
| --- | --- | --- | --- |

- **Rows:** every config or environment key whose definition changed, where optional → required counts as a change;
  every renamed event, queue, class, command or file; every changed binding or behaviour.
- **Hits:** `git grep -n <thing>` over the docs folders (every ADR, not only the ones in the diff), READMEs,
  `CLAUDE.md` / `AGENTS.md` files and docblocks. Read each hit's sentence against the new code.
- **Findings:** every "no" in the last column. The stale sentence usually sits in a doc the PR never opened.

Look in particular for:

- claims that became false: optional → required, "was migrated" while the old path still runs;
- amendment notes on ADRs or specs that do not list every section the edit touches;
- scripts and fixtures the docs tell people to run: check **each literal value** (enum codes, ids, formats) against
  the seed data and the schema. A documented example with a value the schema rejects can never succeed.

**E. Files the PR adds or rewrites.** These must meet every project rule, even when copied from old code:

- no casts that silence the type checker where a narrow one works;
- test titles in the project's style;
- no further copy of an existing helper;
- wrong comments on lines the diff touches get fixed in place, not ticketed.

**F. PR description.** Check that:

- the title describes what merges (with squash merges it becomes the commit). If the branch has a revert commit,
  check each noun in the title against the final diff, and treat a title that names reverted work as a finding;
- the test plan cites the current head and its CI run, not counts from older heads or local runs before a rebase;
- every commit SHA the text cites is on the branch (`git merge-base --is-ancestor <sha> HEAD`);
- follow-ups are *proposed*, never presented as filed when they are not;
- a user-facing change shows the changed screens from the running app (screenshots from a local run), not only
  automated test results.

**G. Scope and ticket history.** From the ticket's change history: was the ticket refined? Can the acceptance
criteria be met as written? Was part of it split out without a ticket? Was anything added to the codebase after the
ticket was written that it now covers? Report these as **facts for the scope conversation**, never as decisions.

**H. Cheaper fix on the other side.** For each behaviour the PR adds and each open question it settles, trace the
flow across layers: the screens, dialogs and callers that reach the changed API, or the API behind a changed screen.
If a layer the PR does not touch offers a cheaper or more complete fix, that is a finding, with its cost and what it
covers. A backend ticket may change the frontend and vice versa. Example: a backend mechanism built to absorb saves
that change nothing, when a "nothing changed" check in the form was a few lines.

## 3. Verify each finding

Re-check each item against the code or infra yourself, and mark it **(verified)** when you did. Delete anything
that turns out wrong. Cite code with links pinned to the head SHA
(`https://github.com/<org>/<repo>/blob/<sha>/<path>#L<a>-L<b>`), so the links survive later pushes.

## 4. Write the review notes

Write `.claude-tmp/tasks/<KEY>/<KEY>-review-notes.md` (local, never committed) with these parts, in order:

1. **Header:** the PRs reviewed at `<sha>`, the date, and "How to read": which items are verified, and that scope
   may change after the scope conversation.
2. **Already solid: no change needed.** What you checked that holds up.
3. **Part 1: applies whatever the scope.** Checkbox items grouped as Rollout and deploy / Docs this PR makes
   wrong / Code and tests in files this PR adds or rewrites / PR description. Each item has a bold one-line
   verdict, the evidence as bullets, and the fix.
4. **Part 2: depends on the scope conversation.** Ticket history and open scope facts, addressed to the scope owner
   or the technical lead.
5. **Existing follow-up tickets vs these items**, as a table (when any exist).

## 5. Triage with the user

Show a short summary and ask per group (`AskUserQuestion`) whether to **fix now**, **draft a ticket**, or **drop**.
Recommend "fix now" for everything in areas A–F. A gap in the behaviour the PR itself adds (an input that slips past
its new check) is always "fix now (Recommended)", even when it looks rare: size the fix before calling it a known
gap. Example: a PR disables Save until a field changes, but a spaces-only edit still enables it; offered as "rare,
harmless" it would ship, while the fix is one small check. Write the ticket drafts to
`.claude-tmp/tasks/<KEY>/<KEY>.follow-ups.md` (title, why, where, proposed scope, acceptance criteria, related, open
questions). Do not file them unless the project's instructions say the agent files tickets.

## 6. Apply what the user chose

1. Commit in logical groups (the project's commit style, default `<KEY>: <imperative summary>`, plus the session's
   attribution trailer), following the rules for the paths you touch.
2. Run the typecheck or build, the unit tiers of the touched modules, and the affected integration specs against the
   local stack. Report known flaky failures by name; don't hide them.
3. Push only with the user's go-ahead, then wait for CI on the new head (`watch-pr-checks`). Re-run a job only for
   infrastructure flakes, such as a failed checkout.
4. Rewrite each PR body only after CI is green on the new head: title, Summary, Deploy notes, Follow-ups (proposed),
   and Test plan citing the head and CI run. Update companion PR bodies the same way. Never tick an author
   checklist.
5. Offer a ticket comment for anything the team must know, such as a changed rollout or a blocker. Match the style
   of the user's latest comment on the ticket: plain verdict first, simple words.
6. Save any new lesson to memory, so it shapes the next task's implementation and PR.

## Gotchas

- In zsh, `git show $SHA:path/...` can expand `$SHA:p` as a modifier and silently write an empty file. Always write
  `"${SHA}:${path}"`.
- Before trusting a local integration run, check which database and services it actually talked to. If a tracked
  test config has to be pointed elsewhere for the run, restore it with `git checkout` straight after.
- When a change flips a published value, `git grep` every spec that pins it, not just the ones in the diff.

## Common mistakes

| Mistake | Instead |
| --- | --- |
| Documenting a rollout that strands data | Redesign it into releases whose rollbacks strand nothing (area A) |
| Reviewing only the lines that changed | Sweep what the change makes *wrong* elsewhere (D) |
| Trusting version and CI claims in the PR body | Re-derive each from tags, pins and checks (C, F) |
| Filing follow-up tickets yourself | Draft them; the user triages |
| Turning scope facts into decisions | Put them in Part 2 as facts, addressed to the people who decide |
| Judging only the layer the ticket names | Trace the flow across layers; a cheaper fix on the other side is a finding (H) |
| Offering a hole in the PR's own new behaviour as a "rare" known gap | Size the fix; recommend "fix now" (§5) |
