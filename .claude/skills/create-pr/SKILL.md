---
name: create-pr
description: Open a pull request for a task branch — preflight the branch and gh access, harvest the local plan and handoff for the description, check the diff for leaked task files with task-cleanup, push, create the PR as a draft and fill its description, then point to the review skills. Use when asked to "open/create/raise a PR", "ship this for review" or "push and PR" a task branch.
user-invocable: true
argument-hint: "[KEY] [--ready] [--base main]"
---

# Create a PR

Input: optional task key (default: from the branch name), `--ready` to open it ready for review instead of draft,
`--base` (default: the repo's default branch, `main` below). Invoking this skill is the user's go-ahead to push the
branch, open the PR and link it on the ticket (§5, item 5); anything beyond that — ticket transitions, other ticket
comments, new tickets, pinging reviewers, chat posts, other repos — is not, unless the project's instructions give
the agent that authority. New tickets never come from this skill; drafts go to the user for the scope owner.

Project specifics (check commands, PR template, title style, draft-or-ready default, how tickets are linked) come
from the repo's `CLAUDE.md` / `AGENTS.md`, contribution docs and recent merged PRs. Where the repo states a
convention, it wins over the defaults here.

## 1. Preflight — stop on any failure

1. **Branch.** Not `main`; named for the task per the project's convention (default `<KEY>-<slug>`);
   `git status --porcelain` shows no modified tracked files.
2. **Base.** `git fetch origin <base>`, then count commits behind: `git rev-list --count HEAD..origin/<base>`.
   Behind and never pushed → rebase onto `origin/<base>`; a conflict → abort the rebase and ask. Behind and already
   pushed → ask before rewriting.
3. **GitHub access.** `gh repo view <owner/repo> --json nameWithOwner`, with the repo from
   `git remote get-url origin`. A failure usually means `gh` is signed in as a different account than git's
   credentials: tell the user to run `gh auth login` or `gh auth switch` for the account that owns the repo, and
   stop. Never change auth yourself.
4. **Checks.** The project's typecheck/build and lint, once. A pre-push hook may run them again; that is fine.

## 2. Harvest the task docs

From `.claude-tmp/tasks/<KEY>/<KEY>.md` and `<KEY>.handoff.md` beside it, collect into a scratch file:

- **Summary input** — the goal, the task split, and each `## Decisions` entry a reviewer must agree with.
- **Test plan input** — the automated coverage lines (commands and results, pre-existing failures called out) and
  every ticked manual check with its observed result.
- **Deploy notes** — rollout steps, cross-repo work (infrastructure, config keys), observability changes, risks.
  Follow the handoff's rollout rules (`implement-task` Phase 6). The plan is step-by-step releases whose rollbacks
  strand nothing; a rollout that needs manual replays or re-publishes goes back to the user before the PR opens.
  Every remaining SQL statement and command is inline in its rehearsed form, never a pointer to the handoff; a
  rollback that says what the old build does with the new build's output and how to recover; sequential manual steps
  with the check between them; cross-repo versions, environment pins and deploy gates checked, not guessed. A handoff
  that falls short of this is fixed before it is copied. A change with nothing to deploy says so in one line.
- **Still open** — unticked handoff items and follow-ups with their triage choice.
- **Scope check** — compare the commits and plan tasks with the ticket's acceptance criteria. Work the ticket does
  not ask for (a rename or refactor beyond the listed items, a task not marked "added in triage") → list it for the
  user and let them choose per item with `AskUserQuestion`: keep it in this PR, revert it and draft a ticket in
  `<KEY>.follow-ups.md`, or revert and drop it.
- **Screenshots** — `.claude-tmp/tasks/<KEY>/evidence/evidence.md`, if `verify-handoff` produced one.

No plan or handoff → build the same inputs from the commit messages and the diff.

## 3. Clean the branch

Run the `task-cleanup` skill for the key. Task files live in the locally ignored `.claude-tmp/` and should never be
in the diff; the skill confirms that, and removes any that leaked in, in one commit. Its check must end clean. Files
it flags as possibly unintended → show them to the user and ask before going on.

## 4. Self-review before pushing

Walk the diff once against the lessons reviewers have already raised on this project (memory, earlier PR threads,
the rule files). Fix what fails; ask when a fix changes scope.

- Deploy notes meet the rules in step 2.
- Docs the diff makes wrong are fixed: ADRs, docs, READMEs and script docblocks that describe the old behaviour.
- Files the diff adds meet every project rule, even when copied from old code: no further copy of an existing
  helper, no casts that silence the type checker where a narrow one works, test titles in the project's style.
- A wrong comment or docstring on a line the diff touches is fixed in place, not listed as a follow-up.
- Anything temporary the rollout keeps has a named removal home among the follow-ups.

## 5. Push and open

1. `git push -u origin <branch>`.
2. Title in the project's style (default `<KEY>: <imperative summary>`). If the repo squash-merges, the title
   becomes the commit subject on `main`, so keep it under ~72 characters and in the style of
   `git log --oneline origin/main`. Derive it from the final diff: after a revert, the title drops what no longer
   merges.
3. Create the PR, draft unless `--ready` (or unless the project opens PRs ready), with the repo's PR template as the
   starting body when it has one:

   ```bash
   gh pr create --draft --base <base> --title "<title>" --body-file <pull request template, or a drafted body>
   ```

4. Fill the body from the harvested inputs (with the project's PR-description skill if it has one). Follow the
   template's sections; without a template use the ticket line, `## Summary` and `## Test plan`, scaled to PR size.
   Deploy notes go in the template's section for them, or under a bold **Deploy notes** label inside the Summary.
   Follow-ups the user triaged as "draft ticket" go under a bold **Follow-ups (proposed)** label after it, one line
   each, with no ticket key unless one has really been filed. The Test plan cites the current head and its CI run,
   never counts from an older head. If the template has an author checklist, never tick it: those boxes record what
   the author verified.
5. **Link it on the ticket.** If the tracker does not link PRs by itself (through the branch name, the title key or
   a `Closes #N` line), add a comment on ticket `<KEY>` through the tracker's tools. Read the ticket's comments
   first: list this PR, plus any open PR for the same key in another repo
   (`gh pr list --repo <owner/repo> --search "<KEY> in:title"`) that no comment links yet. Links only — no status or
   summary:

   ```
   **PRs**

   * [<repo>#<n>](<url>): <PR title without the key>
   ```

## 6. Screenshots

`gh` cannot upload images to a PR. When the evidence index lists screenshots, add a **Screenshots** item under the
Test plan naming each one and what it shows, and give the user the path of each file in
`.claude-tmp/tasks/<KEY>/evidence/` so they can drag them into the description on GitHub. Never commit
screenshots to the branch to work around this.

## 7. After opening

Not part of opening. `watch-pr-checks` waits for CI. When reviewers leave comments and fixes are pushed, verify each
unresolved thread against the PR head before replying (`prepare-for-testing` step 1). The task's plan and handoff
stay in `.claude-tmp/tasks/<KEY>/` for follow-up work; after the merge, `task-cleanup <KEY> --purge` archives the
folder.

## Report

- PR URL, draft or ready, title, base, commits pushed.
- The ticket link (auto-linked, the comment posted, or why it could not be posted).
- What the author still has to do: tick the author checklist, drag in the screenshots (with their paths), mark ready
  and request reviewers.
- Deploy notes and cross-repo work that must land with or before the merge.
- The path of the task's local folder, and of `<KEY>.follow-ups.md` when it holds drafts.
- Before marking it ready or requesting reviewers: `self-review-pr <KEY>` reviews it the way a reviewer would
  (rollout and rollback, cross-repo facts, docs the change makes wrong, PR text) and triages what it finds;
  `prepare-for-review <KEY>` works through the PR template's author checklist.
- For reviewers: `changes-notes <KEY>` publishes a plain-language page of what changed and what it affects, and
  `testing-notes <KEY>` publishes the acceptance criteria with their tests and evidence. Each offers a link line for
  the PR description.
