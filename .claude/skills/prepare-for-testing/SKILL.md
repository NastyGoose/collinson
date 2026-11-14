---
name: prepare-for-testing
description: Use when an already-reviewed task PR (or stacked PRs) should be made merge-ready and handed to QA or whoever tests it — "prepare for testing", "get it ready to merge", "move it to testing", "make sure we're ready to give it a go" — after review rounds, new reviewer nits, or main moving under the branch.
user-invocable: true
argument-hint: "[KEY | PR numbers]"
---

# Prepare for testing

The deep review already happened. This pass is fast and factual: close what reviewers left, bring the branch up to
date, prove it still works with evidence, and leave the PR in a state whoever merges can merge and whoever tests can
test without asking anything. Input: a task key (default: from the branch name). Read
`.claude-tmp/tasks/<KEY>/<KEY>.md` and `<KEY>.handoff.md` first; find every PR of the task (stacked PRs: base
first). `main` below is the repo's default branch.

Who merges, who tests and what the agent may do alone come from the project's instructions (`CLAUDE.md` /
`AGENTS.md`, contribution docs). By default: outward actions — push, PR comments and bodies, chat, the tracker —
need the user's go-ahead unless they gave it for this run; do not merge; do not file tickets (drafts go to the user
for the scope owner); never contact external parties directly.

## Steps

1. **Comments.** List unresolved threads and reviews since the last push (`gh api graphql` reviewThreads, reviews,
   issue comments). For each: fix in scope (one commit per comment), or answer why not. A suggestion that is real but
   not needed for this PR becomes a ticket description in `.claude-tmp/tasks/<KEY>/proposed-ticket-<slug>.md` plus a
   short proposal for the scope owner — not a filed ticket. Draft one reply per thread naming the fix sha.
2. **Up to date with main.** `git fetch origin main`; merge `origin/main` into the base branch, then the base into
   each stacked branch. Merge, not rebase, unless the user or the project's convention says otherwise: PR bodies and
   replies cite shas, and a squash merge flattens history anyway. Resolve conflicts keeping both intents; where main
   already did what the branch did, take main's version. Check main's new commits for semantic breaks git can't see
   (constructor dependencies, renamed events, required fields): the typecheck catches some, integration tests catch
   wiring.
3. **Fast self-review** of the commits since the last reviewed head only: rules compliance and a test review on the
   changed files (the project's skills for them, if any), plus a grep of the PR body against the code for stale
   facts (heads, counts, gates, removed items).
4. **Related tests.** Typecheck or build and lint, the unit tier of every touched module, integration specs for
   every touched area. If integration runs share a local database or other state, isolate it when another session
   may be running too. Record counts; rerun a timeout-only failure in an untouched file once, alone.
5. **Scenario with evidence.** Run `verify-handoff` for the handoff's Browser and Shell items on the local stack:
   each tick names what was observed, with the screenshot or command output saved under
   `.claude-tmp/tasks/<KEY>/evidence/` and indexed in `evidence.md` (scenario → observed → files). Snapshot the
   counts before each action so every row and log line is attributable. Back up any config file you edit, restore it
   afterwards, then delete the backup and scan `evidence/` and the browser tool's output folder for secrets. Explain
   every timing oddity before calling the scenario green.
6. **Push and CI.** `git fetch origin main` again first: main moves during a long run, and branch protection may
   need the branch current. Push (fast-forward only), then `watch-pr-checks` until green. Update each PR body: head,
   CI link, counts, the scenario, anything the fixes changed. Grep each body draft for every commit since the live
   body's head; a draft written before the last commits silently drops them.
7. **Readiness gate.** Fill this table; any "no" is a blocker to report, not to work around. Drop rows the project
   does not have.

   | Check                                                    | How                                               |
   | -------------------------------------------------------- | ------------------------------------------------- |
   | Approved at the current head, if approval is required    | `gh pr view --json reviewDecision`                |
   | Mergeable, up to date if branch protection requires it   | `mergeStateStatus` CLEAN (not BEHIND/DIRTY)       |
   | Required checks green at the head                        | `gh pr checks`                                    |
   | Every thread answered or resolved                        | reviewThreads                                     |
   | PR body matches the head                                 | step 3 grep                                       |
   | Companion changes applied where the PR needs them        | environment pins / `git tag --contains` over there |
   | Merge order and gates for stacked PRs stated             | PR bodies                                         |
   | No task files in the diff                                | `task-cleanup`                                    |
   | Ticket deliverables outside code (docs pages, AC edits)  | plan's requirement list                           |

8. **Hand to testing.** Draft the ready-for-test notes for the ticket (merge and deploy order, per-step tests with
   environment, UI actions and exact log queries, what-if lines, acceptance criterion → step) and a short
   status-first message to whoever merges. Messages name work by ticket key, not PR number. Move the ticket's status
   only with the user's go-ahead.

## Report

The readiness table, the commits added with what each fixes, test counts, evidence paths, drafts waiting for the
user's OK, and blockers with who clears each.
