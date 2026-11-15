# Claude Code skills: task implementation and PRs

A project-neutral set of skills for taking a tracker task from ticket to merged PR. They carry the method (score,
plan, implement, verify, hand off, review) and read everything project-specific from the repo they run in.

## Install

In this repository the skills are already installed at project level in `.claude/skills/`, next to this file.

To make them available to every project, copy them into your personal skills folder:

    mkdir -p ~/.claude/skills
    cp -R .claude/skills/* ~/.claude/skills/

## The skills

| Stage | Skill | What it does |
| --- | --- | --- |
| Before | `task-explainer` | Explains a ticket on a published page, checked against the code, before work starts |
| Build | `implement-task` | Scores the ticket, gathers sources, writes a local plan, implements, verifies, writes a handoff |
| Build | `verify-handoff` | Walks the handoff's manual checks on the local stack and saves evidence |
| Build | `resume-task` | Rebuilds where a task stands after a break, from notes, PRs, git, the tracker and chat |
| PR | `task-cleanup` | Keeps task working files out of the PR diff; archives a finished task's folder |
| PR | `create-pr` | Preflights, harvests the plan and handoff into the description, pushes and opens the PR |
| PR | `watch-pr-checks` | One background job that reports when the PR's CI finishes |
| Review | `self-review-pr` | Reviews your own PR the way a production-owning reviewer would, then triages the findings |
| Review | `prepare-for-review` | Works through the PR template's author checklist; answers yes or no per line |
| Review | `reviewing-teammate-prs` | Drafts a review of someone else's PR in your voice, posted only after you approve |
| Review | `pr-walkthrough` | Publishes a "what changed" page for reviewers and QA |
| Ship | `prepare-for-testing` | Closes review threads, updates the branch, re-proves it and drafts the hand-over to testing |

`task-explainer/template.html` is the page template shared by `task-explainer` and `pr-walkthrough`.

## Agents and rules

These are project-specific, unlike the skills above.

| Kind | File | What it does |
| --- | --- | --- |
| Agent | [`agents/architect.md`](agents/architect.md) | Read-only architect. It audits module dependencies and file structure against ADR 0006, reviews a branch or PR for layout and boundary problems, and proposes where new code goes. It returns a module map, findings with `path:line`, and a migration list for audits |
| Rule | [`rules/code-structure.md`](rules/code-structure.md) | The working form of ADR 0006, loaded when Claude works in `src/` or `test/` |

Ask for the agent by name, for example "use the architect to review this branch" or "ask the architect where the new
cache should go". `npm run lint:structure` is its mechanical counterpart in CI.

## What the skills expect from a project

Nothing is hardcoded. Each skill looks these up in the repo (`CLAUDE.md` / `AGENTS.md`, README, contribution docs,
package scripts or Makefile, CI config, recent branches and PRs), and the repo's convention wins over a skill's
default:

- **Tracker**: Jira, Linear, GitHub Issues or another, reached through its MCP tools or a CLI. The ticket key (or
  issue number) names the branch, the commits and the task folder.
- **Commands**: build or typecheck, lint, test tiers, how to start the local stack.
- **Conventions**: branch names (default `<KEY>-<slug>`), commit and PR titles (default `<KEY>: <summary>`), the PR
  template and its author checklist, the default branch (written as `main` in the skills).
- **Rules and docs**: rule files, ADRs, glossary, testing conventions.
- **People and authority**: who owns scope (the "scope owner") and technical direction (the "technical lead"), who
  merges, and what the agent may do without asking. By default the skills push, post, merge and file tickets only
  with the user's go-ahead; a project whose instructions give the agent more authority overrides that.

Putting these facts in the project's `CLAUDE.md` saves every skill from rediscovering them.

## Local task folder

All working files live in `.claude-tmp/tasks/<KEY>/` inside the repo and are never committed: the plan and work log
(`<KEY>.md`), the handoff (`<KEY>.handoff.md`), ticket drafts (`<KEY>.follow-ups.md`), review notes, `evidence/` and
the links to published pages (`artifacts.md`). `implement-task` makes sure the folder is ignored through
`.git/info/exclude`, and `task-cleanup` checks that nothing from it leaked into a PR.

## Optional pieces

Some steps use tools a session may not have and are skipped without them: a design tool connector (design
comparison), browser automation (`verify-handoff`), a chat connector (`resume-task`), and the Artifact tool
(`task-explainer`, `pr-walkthrough`). Where a project has its own reviewer, test-review, rules or docs skills, the
skills here call those; otherwise they fall back to the built-in `code-review` and `security-review`.
