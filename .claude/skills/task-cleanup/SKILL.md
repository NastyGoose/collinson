---
name: task-cleanup
description: Make sure no task working files — implement-task plans and handoffs, verification evidence, local-only skills — reach the PR diff; remove any that leaked into git, and optionally archive a finished task's local folder. Use before opening a PR, when asked to "clean up task docs/artifacts", or from create-pr.
user-invocable: true
argument-hint: "[KEY] [--purge]"
allowed-tools: Bash, Read
---

# Task cleanup

Task working files live in the locally ignored `.claude-tmp/` folder and never belong in a commit:

| Path                                       | Holds                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `.claude-tmp/tasks/<KEY>/<KEY>.md`         | implement-task plan and work log                                      |
| `.claude-tmp/tasks/<KEY>/<KEY>.handoff.md` | handoff checklist                                                     |
| `.claude-tmp/tasks/<KEY>/evidence/`        | verify-handoff screenshots and command output                         |
| `.claude-tmp/skills/`                      | local-only skills, if any are linked into `.claude/skills/` from here |

This skill checks that none of it — nor older leftovers — is in the branch's diff. Input: a task key; without one,
take it from the branch name (`PROJ-123-short-slug` → `PROJ-123`). `main` below is the repo's default branch.

## Steps

1. **Preflight.** Not on `main`. `git status --porcelain` shows no modified tracked files; if it does, stop and ask
   — the cleanup commit must contain only removals. `git check-ignore -q .claude-tmp` succeeds; if it does not, add
   `/.claude-tmp/` to `.git/info/exclude`.
2. **Find leaks.** Compare the branch with its merge base:

   ```bash
   git fetch origin main --quiet
   git diff --name-only --diff-filter=AM "$(git merge-base origin/main HEAD)"..HEAD
   ```

   A leak is any path under `.claude-tmp/`, any tracked copy of a task plan, handoff or evidence file elsewhere in
   the repo, browser-automation output folders (such as `.playwright-mcp/`), or a `.claude/skills/<name>` that is a
   symlink into `.claude-tmp/`. Also flag, without removing, anything that looks unintended: `*.log`, images outside
   documented asset folders, `.env*` and other private local config, scratch or `tmp` files.

3. **Remove leaks.** For each leaked task file, copy it into `.claude-tmp/tasks/<KEY>/` first if a local copy does
   not exist yet (compare with `cmp`), then `git rm` it and commit only those removals, in the project's commit
   style:

   ```
   <KEY>: move the task notes out of the repository
   ```

   plus the attribution trailer the session requires. Nothing leaked → no commit. Flagged non-task files → list them
   and let the user decide.

4. **Re-check.** Run the diff from step 2 again; no leak may remain.
5. **`--purge` only, after the PR is merged:** move `.claude-tmp/tasks/<KEY>/` to
   `.claude-tmp/archive/<KEY>-<yyyy-mm-dd>/`. Never delete a task folder outright, never touch another key's folder,
   and never touch `.claude-tmp/skills/`.

## Report

- Leaks found and removed, with the commit sha, or "diff is clean".
- Flagged files, one per line, for the user to decide on.
- Where the task's local folder is (or was archived to).
