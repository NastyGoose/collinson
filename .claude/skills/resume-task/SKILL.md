---
name: resume-task
description: Use when the user asks to be caught up on a task from earlier sessions — "update me on PROJ-123", "where are we with …", "what did we decide yesterday", "is it ready for review", "resume yesterday's work", "give me everything I need to proceed" — or before continuing a task branch after a break.
user-invocable: true
argument-hint: "[KEY] (default: every .claude-tmp/tasks/<KEY>/ folder changed in the last 3 days)"
allowed-tools: Bash, Read, ToolSearch
---

# Resume a task

Rebuild where a task stands from every place its state lives, then brief the user. The brief says whether the
task is ready for review, what was decided, what blocks it and what to do next. Local notes go stale between
sessions: a plan can describe a rollout that was replaced, and a log line saying "local merge is clean" can
predate the base branch moving. So check every claim in the brief against the live source, and name each note that
is now wrong. This skill is read-only. Changing anything is the user's call after the brief.

## 1. Gather

Run independent reads in parallel. Skip a source the project does not have or the session cannot reach, and say in
the brief that it was not read.

| Source | What to read |
| --- | --- |
| Task folder `.claude-tmp/tasks/<KEY>/` | plan and its **Log** (newest entries first), handoff, follow-ups, review notes, `evidence/` |
| Companion repos' task folders | the same folder in each sibling checkout the task touches (`../<other-repo>/.claude-tmp/tasks/<KEY>/`, and any per-task clone) |
| Strays | untracked `<KEY>-*.md` in the main checkout's root (`git status`), notes next to the repo (`../<KEY>-*.md`) |
| PRs in every repo the task touches | `gh pr list --search <KEY> --state all`, then per PR `gh pr view <n> --json state,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefName,baseRefName,headRefOid,reviews,statusCheckRollup,body`, issue comments, and review threads (`gh api repos/<owner>/<repo>/pulls/<n>/comments`) |
| Git | `git fetch origin`, then `git worktree list`. Map each PR's `headRefName` to the worktree and local branch holding it (local names can differ, and a PR can be stacked on another PR's branch). Per PR branch: ahead/behind its `baseRefName`, `git merge-tree --write-tree --name-only origin/<base> origin/<head>` for textual conflicts, and `git log --oneline origin/<base> --not origin/<head> -- <paths the branch touches>` for base changes that can break it without a conflict. Also compare every local branch with its remote sha: local commits missing from the remote are left over from a force-push |
| Release gates | Where the task depends on a release elsewhere: the tags containing the merge commit, what each environment is pinned to, and open promotion or version-bump PRs. Check what each promotion actually carries; an older open promotion does not include a later merge |
| Tracker | The ticket with its comments and links, through the tracker's tools: status, recent comments, and the status of linked follow-up tickets |
| Team chat | If a chat connector is available: search since the day before the last log entry, once for the key and once per person involved (the reviewer, the scope owner, the technical lead, whoever chases status). Read every direct-message and thread hit in full, because scope and follow-up decisions are often made there |

Who the people are comes from the PR (author, reviewers), the ticket (reporter, assignee) and the project's docs or
memory; do not guess identities.

## 2. Reconcile

- **The newest source wins.** A chat decision, ticket comment or PR body dated after the last log entry overrides
  the plan and the handoff.
- **Check each "done" claim live:**
  - "CI green": the checks on the current head sha.
  - "merge is clean": `merge-tree` against a freshly fetched base. A clean `merge-tree` is not proof: if the base
    changed an interface or type the branch uses, say the branch needs a typecheck after merging the base.
  - "tickets deleted" or "tickets filed": their status in the tracker.
  - "applied in <environment>": what that environment is pinned to now.
  - "the ticket lists every PR": flag it when a PR was split out or added later.
- **People waiting on the user go first.** Examples: a reviewer who wrote "I'll wait until he's done", someone who
  will "look tomorrow morning", a lead asking why items sit in review.

## 3. Brief

Use these sections, in this order:

1. **Verdict:** ready for review or not, with the one-line reason.
2. **Since last session:** dated events. Who decided what, each linked to its message or comment.
3. **Release plan as agreed now:** the steps and the gate before each one.
4. **Blockers:** each with the person who can clear it.
5. **Next steps:** ordered, each one a concrete action.
6. **Stale local files:** each with what is wrong in it.

End by offering to start the first next step.

## Common mistakes

| Mistake | Instead |
| --- | --- |
| Trusting the plan's log or the handoff over the PR body and chat | Date every source; the newest wins |
| Ahead/behind without `git fetch` first | Fetch, then compare and `merge-tree` |
| Calling a clean `merge-tree` "ready to merge" | Check the base's commits on paths the branch touches; a changed type breaks without a conflict |
| Comparing a stacked PR with the default branch | Compare each PR with its own `baseRefName` |
| Searching chat only for the key and PR numbers | Also search conversations with the reviewer, the scope owner and the technical lead |
| Reading only channel messages | Read the direct messages too, where decisions are made |
| Missing notes outside the task folder | Check the repo root's untracked files and `../<KEY>-*.md` |
| Reporting check status from the notes | Read `statusCheckRollup` on the live head |
