---
name: verify-handoff
description: Walk a task's handoff checklist (.claude-tmp/tasks/<KEY>/<KEY>.handoff.md) against the local stack — drive the UI with a browser automation tool, query the database and other local services from the shell — record the evidence for each item, and capture screenshots for the PR. Use after implement-task, or when asked to "check the handoff", "verify by hand", "click through it" or "get screenshots for the PR".
user-invocable: true
argument-hint: "[KEY]"
---

# Verify a handoff

Input: a task key (`PROJ-123`); without one, take it from the branch name. Read
`.claude-tmp/tasks/<KEY>/<KEY>.handoff.md` and the plan `.claude-tmp/tasks/<KEY>/<KEY>.md` in full before
doing anything.

The goal is **evidence**, not ticks. A box is ticked only when you observed the expected result yourself, and every
tick names what you observed and where the proof is saved.

How to build, start and seed the local stack comes from the project (`CLAUDE.md` / `AGENTS.md`, README, Makefile or
package scripts) and from the handoff's own prerequisites.

## 1. Sort the items

Go through every unticked checkbox and put it in exactly one bucket:

| Bucket      | Examples                                                                       | Who                         |
| ----------- | ------------------------------------------------------------------------------ | --------------------------- |
| **Browser** | click through a screen, submit a form, see a status, compare to a design frame | you, via browser automation |
| **Shell**   | DB query, queue depth, a script, an API call without a login, a CLI run        | you, via Bash               |
| **Human**   | another repo, deployed environments, monitoring, the tracker, secrets, the PR  | the user — skip             |

For an app that is not a web app (a desktop app, a game, a CLI), "Browser" means whatever tool drives it in this
session: the `run` skill, an editor or device connector, or the command line.

Human items stay unticked; list them in the report. Never act on a shared or deployed environment unless the user
names it explicitly — this skill works on the local machine.

## 2. Preconditions

- **Branch and build.** On the task branch; anything the app loads from a build output (shared packages, generated
  code) rebuilt from it.
- **Stack.** Probe the ports the handoff uses (`curl -s -o /dev/null -w "%{http_code}"`) and the app's health
  endpoint, if it has one. Down → start it the project's way, or ask the user to; a port held by a stale dev server
  → identify the process (its command line, working directory and parent) before stopping it.
- **Local infra.** Run whatever the handoff's prerequisites name (seed scripts, local emulators, sync scripts) —
  they should be idempotent locally; ask before running one that is not.
- **Browser automation.** Use the session's browser tools: load them with `ToolSearch` if they are deferred
  (Playwright MCP, a built-in browser, a Chrome connector). None available → do the Shell bucket now, then tell the
  user which tool to add and how.

## 3. Logging in

**Never type, request, store or screenshot a password, token or secret**, other than test credentials that belong to
the app's own local seed data. Navigate to the app; when it lands on a third-party login page, fill the email if the
user has given it, then stop and ask the user to finish the login in the browser window. **Never snapshot or
screenshot the login page:** the browser can autofill a saved password, and an accessibility snapshot prints field
values. After each navigation, read the page URL in the result; on the identity provider's host, stop there and ask.
A user who can log in but sees no access usually needs the project's local admin or seed step — find it in the
project's setup docs.

## 4. Drive the checks

- Snapshot first, act on refs from the snapshot, snapshot again after every action that changes the page. Wait for
  text, not for fixed times, unless a background pipeline has no visible signal.
- Prefer a flow a user would really take over a shortcut that skips what the change touches.
- Test data you create is local only; name it recognisably (e.g. the task key in a free-text field) so it is easy
  to find later.
- Pair every UI observation with the backend fact behind it when the change is backend work: the stored row, the
  queued message, the consumer's write. A screen alone can hide a failure that retries later.
- A result that differs from the expectation: find out why before judging. Check whether the expectation was wrong
  (a list that hides finished items, a route that takes a different id) or the change is — compare with the default
  branch when in doubt. Never fix product code in this skill; report it.

## 5. Evidence

Save everything under `.claude-tmp/tasks/<KEY>/evidence/` (locally ignored, and inside the repo, where browser
tools are usually allowed to write). Pass the screenshot tool that path as its filename; a tool's default output
folder is not where the task's evidence lives.

- **Screenshots** of the screen that proves an item: `NN-<slug>.png`, numbered in walkthrough order. Frame the
  proving element — a full page only when context matters. Nothing from login pages, `.env` files, DevTools
  headers or anything holding a token.
- **Shell proof**: the command and its trimmed output as `NN-<slug>.txt`.
- **Index**: `evidence/evidence.md` — one line per file: item name, file, what it shows. `create-pr`
  reads this to offer screenshots for the PR description.

## 6. Record results in the handoff

- Tick a verified item and add one indented line: date, what was observed, the evidence file.
- Wrong expectation → rewrite the expectation, tick it, and say in the note that it was corrected.
- Failure → leave it unticked with `FAILED <date>: <observed>` and the evidence file; investigate as far as the cause.
- Wrap at 120 characters. The handoff is local and never committed.

## Report

A table of item → result → evidence file, failures first. Then the Human items still open, and the path of the
evidence folder.
