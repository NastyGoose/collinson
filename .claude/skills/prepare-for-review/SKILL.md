---
name: prepare-for-review
description: Use when a PR's author checklist (the checklist in the repo's PR template, or the team's definition of "ready for review") has to be worked through — "go through the checklist", "what can I tick", "prepare for review", "is it ready to mark ready", "can I self-approve" — before a draft goes to reviewers or before the author signs off alone.
user-invocable: true
argument-hint: "[PR number | KEY]"
---

# Prepare a PR for review

An author checklist records what the author verified. This skill works every line until it is complete or blocked
on something only the author or another person can do. It then answers **yes or no per line, with the reason for
each no**. **The author ticks the boxes, never the agent**: not in the PR, not in a draft body, not with "N/A".

Input: a PR number or task key (default: the current branch's PR). The checklist is the one in the PR body (from the
repo's PR template or contribution docs). When the project has none, use the default lines in the table below.
`main` is the repo's default branch.

**Allowed without asking:**

- read-only work and sub-agents;
- temporary edits that are reverted (the can-fail check, §4);
- local commits that fix the PR's own lines: a rule broken in a line it adds, a doc or comment it made wrong, a
  defect in a test it adds.

**Ask first, with `AskUserQuestion`:**

- anything that changes behaviour or scope, removes a test, or leaves a finding unfixed (a judgment call);
- follow-up tickets.

Pushes, PR body edits, tracker and chat posts each need the user's go-ahead, unless the project's instructions give
the agent that authority. Ticket drafts go to `.claude-tmp/tasks/<KEY>/<KEY>.follow-ups.md` for the user to take to
the scope owner.

## When a line is "yes"

Map each line of the project's checklist to one of these kinds. Default checklist, when the project has none:

| Kind of line | Yes when |
| --- | --- |
| "I read every line of the diff" | Never yes: only the author can read the diff |
| An automated reviewer was run (code review, test review, security review, rules, docs) | That reviewer ran in a fresh agent on the current head, and each finding is fixed, settled (with a citation) or decided by the user |
| Tested against all acceptance criteria | Every criterion has evidence (test, screenshot, command output) on code unchanged since; a user-facing change has been driven by hand |
| Tests assert real behaviour and can fail | Every test the PR adds fails under at least one mutation (§4), and the test review reports none that "cannot fail" |
| Debt fixed or ticketed | No in-scope debt is left, and every out-of-scope item has a filed ticket linked from the PR; no `TODO` without a real ticket reference |

"Current head" means the head that will be reviewed. After a fix commit, every line that depends on the code runs
again on the new head.

## 1. Gather

- `gh pr view <n> --json headRefOid,isDraft,body,statusCheckRollup,mergeStateStatus`. Bring the task worktree to the
  PR head with `git merge --ff-only`; never reset.
- **The PR's own diff:** `git diff origin/main...<head>`. Commits that came in from main are not under review.
- **CI:** the run at the head. Name each failing test. Call it unrelated only when the diff cannot reach it, or when
  the same test fails on main too.
- The plan, the handoff and `evidence/` in `.claude-tmp/tasks/<KEY>/`, and the ticket's acceptance criteria.
- **Review worktree:** `git worktree add --detach ../<repo>-<n>-review <head>`. The reviewers read this checkout, so
  the can-fail check can edit the task worktree at the same time.

## 2. Reviewer lines

Send all of them in one message: one fresh `general-purpose` agent per reviewer, never a fork, because a fork
carries this session's context.

| Reviewer | Where it comes from | How the agent loads it |
| --- | --- | --- |
| Code review | the repo's reviewer skill or agent, if any; otherwise the built-in `code-review` with the PR number | Skill tool, or read the repo skill's `SKILL.md` and follow it |
| Test review | the repo's test-review skill, if any; otherwise a prompt: "for each test this diff adds, say what behaviour it pins and whether it can fail" | same |
| Security review | the built-in `security-review`, in an isolated worktree at the head | Skill tool only; see below |
| Rules compliance | the repo's skill, or the changed files read against the project's rule files | same as code review |
| Docs | the repo's docs skills, or: statements the diff makes wrong, and docs the change should have added | same |

Run the reviewers the checklist names; do not add lines the project does not ask for.

Each agent prompt contains:

1. the review worktree path and the head SHA;
2. the scope: `git diff origin/main...HEAD` and the changed file list;
3. the reviewer to load, and how;
4. "read-only; post nothing; reply with the reviewer's own output only".

Save each reply verbatim to `.claude-tmp/tasks/<KEY>/review/<reviewer>.md`, adding a suffix for each re-run.

**Built-in review commands read the session's own checkout.** When `security-review` loads, it fills in its git
status and diff from the working directory the session started in, and a plain sub-agent inherits that directory.
`code-review` without a PR number does the same. So:

- give `code-review` the PR number, so it fetches the PR itself. It reads GitHub, so it sees fix commits only after
  a push;
- start the `security-review` agent with `isolation: "worktree"`. Its first step is `git checkout --detach <head>` in
  its own worktree, and only then does it load the command. Its reply starts with the files the pre-filled git
  section lists. When they are not the PR's changed files, the run does not count, and nothing else runs under the
  command's name;
- afterwards, unlock and remove that worktree, and delete its temporary branch once
  `git rev-list --count origin/main..<branch>` is 0.

**Work the findings to a close:**

1. Merge the same defect reported by several reviewers into one finding.
2. Verify each finding against the code, and drop the wrong ones.
3. Mark one settled when a PR thread, the plan's `## Decisions` or an existing ticket already decided it. Search the
   tracker before proposing a draft.
4. Fix the PR's own lines and commit (the project's commit style, plus the session's attribution trailer).
5. Put everything else to the user: **fix now**, **draft a ticket**, or **won't fix** with a reason.
6. Run the affected specs, then run again every reviewer whose last run predates the new head. Repeat until no
   finding is open.

## 3. Acceptance criteria

Find evidence for each criterion: a test name, a screenshot or command output. Evidence from an older head counts when
`git diff <old>..<head> -- <files the criterion depends on>` is empty.

## 4. Tests can fail

In the task worktree, break the production code and run the specs that cover it:

1. **Revert the change:** `git checkout origin/main -- <production files>`. Every test of new behaviour must fail.
2. **Remove each guard on its own:** take out each filter, exclusion or validation the diff adds or relies on. A test
   that passes without the change by construction ("excluded when retired") can fail only here. When a guard's case
   lives in another tier, run that spec too.
3. **Restore:** `git checkout <head> -- <files>`, then confirm `git status` is clean.

Never edit a test file and never commit a mutation. Write each mutation and its counts to
`.claude-tmp/tasks/<KEY>/review/can-fail.md`.

## 5. Debt

- **In scope** (small and in the blast radius, so fix it here):
  - docs and comments that the diff makes wrong: grep every endpoint, symbol and behaviour it changes;
  - a `TODO` without a real ticket reference on a line the diff touches;
  - scaffolding left behind.
- **Out of scope:** each item needs a filed ticket that the PR links. Draft the missing ones for the scope owner.

## 6. Answer

Reply with this and nothing longer:

```
#<n> at <short head> — CI <green | failing: test, verdict>
1. no — only you can read the diff (<n> files; start at <file:symbol>)
2. yes
…
N. no — <what is missing>; done when <who does what>
Done for you: <commits, with one line each> | Needs you: <decisions or actions, if any>
```

A "no" names the missing thing and who clears it. The raw output stays in `review/` and is cited only when asked.

## 7. Clean up

`git worktree remove` the review worktree, and remove the isolated agent worktree as in §2. Confirm the task worktree
is clean, including any tracked config that was changed for a local test run.

## Gotchas

- A tracked test config that pins a port or host the local machine does not use: change it for the run, then
  `git checkout` it straight after.
- Specs that import a sibling package from its build output need that package rebuilt after a merge from main,
  before the can-fail runs.
- Take pass and fail counts from the test runner's summary line, not from a grep of failure markers, which can
  count each failure twice.
- A spec file the mutation runs are using must not be edited until they finish.

## Common mistakes

| Mistake | Instead |
| --- | --- |
| Ticking a box, or writing `[x]` in a draft body | Answer yes or no; the author ticks |
| A long report instead of the answer | Yes or no per line; a reason only for a no |
| "Yes" from a reviewer run on an older head | Run it again on the current head |
| Forking, or reviewing in this session | One fresh `general-purpose` agent per reviewer |
| `security-review` in a plain sub-agent | An isolated worktree at the head; check the files its pre-filled diff lists |
| "Tests can fail" because the change's revert turns them red | Also remove each guard; exclusion tests only fail there |
| Trusting evidence from an older head | Diff the old head with the current one over the files the criterion depends on |
| "CI failure is probably a flake" | Name the test; show the diff cannot reach it, or that it fails on main too |
| Mutating files that the reviewers are reading | The reviewers read the detached review worktree |
