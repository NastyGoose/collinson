---
name: task-explainer
description: Before implementing a tracker task, explain it on a published artifact page. The page covers the problem in plain words, diagrams of how it works today and how it should work, the acceptance criteria paraphrased, ordered steps, gotchas the ticket does not mention, and each open decision with a recommendation. Every claim is checked against the code on origin/main. English by default; `--ru` writes the page in Russian. Use when the user hands over a ticket key or link and asks to explain, summarize, walk through or "guide me through" the task before starting, or asks for an explainer page or artifact for it.
user-invocable: true
argument-hint: "<task-url-or-key> [--ru] [--new]"
---

# Explain a task before implementing it

Input: a ticket URL, key or issue number from the project's tracker (`PROJ-123`, `#456`, a Jira, Linear or GitHub
Issues link). Extract the key; for a bare issue number use the number. `origin/main` below means the repo's default
branch on the remote.

Flags:

- `--ru`: write the page copy in Russian. The default is English. In both languages, keep code identifiers, paths,
  scopes, error codes, routes, env vars and ticket statuses verbatim.
- `--new`: publish a separate artifact instead of updating the one already recorded for this key and language.

The chat reply follows the language of the user's message, not the flag.

The skill is read-only for the repo and the tracker. It creates no branch, makes no code edit, posts no ticket
comment and does no transition. It ends with one published page and a short reply. Implementation belongs to
`implement-task`. Depth to aim for: a developer new to the area can start the work from the page alone, and every
behavioural claim on it carries a `path:line`.

## 1. Gather

Run independent reads in parallel.

| Source | How |
| --- | --- |
| Ticket | The tracker's tools (load its MCP tools with `ToolSearch`, or a CLI such as `gh issue view --comments`): summary, description, status, type, priority, parent, links, comments, assignee, reporter |
| Linked issues | Summary and status only for the parent and each linked issue. A done sibling that solved the same problem elsewhere is the precedent to cite |
| Task folder | `.claude-tmp/tasks/<KEY>/`: plan, notes, `artifacts.md`. A plan with a `## Decisions` section means work has started. Say so in the header and keep those decisions |
| Code | `git fetch -q origin main`, then `git show origin/main:<path>` and `git grep -n <pattern> origin/main -- <paths>`. Never read the working tree: the checkout is often another task's branch |
| Docs | The ADRs, docs pages and `CLAUDE.md` / `AGENTS.md` files that the ticket or the code names. Read the sections the change touches, not whole folders |

If the ticket spans more than about six files, or the area is unfamiliar, delegate the sweep to an `Explore` agent and
keep only its conclusions.

## 2. Check the ticket against the code

A ticket's "Current state" is written from memory, and memory drifts. For every concrete claim (a function never
receives X, a constant is hardcoded, a rule is missing, "roughly eight places"), find it on origin/main and note
`path:line`.

- **Confirmed**: cite `path:line` on the page.
- **Different**: show both on the page, as "The ticket says …; on main the code does …". Never silently correct the
  ticket.
- **Not found**: say so.

When the ticket estimates a count, give the real list.

## 3. Find what the ticket does not say

Look for each kind below. Every one you find becomes a gotcha card (keyed A, B, C…) with `path:line` evidence.

- **Tests that will break by design.** Existing specs whose setup (tokens, fixtures, mocked guards) encodes the
  behaviour being changed.
- **Preconditions outside the repo.** Identity-provider grants, env vars, infra config and per-environment data
  (each environment, test stubs) that must already hold, or the deploy breaks production. Frame each from the rollback: what fails,
  for whom, and how to back out.
- **Behaviour the criteria say must not change.** Error codes, response shapes, the order of checks. Show which
  implementation choice would break it.
- **Testability gaps.** A criterion that cannot be tested literally with what the code has (one enum value, no
  fixture, no second tenant), and how the precedent ticket handled it.
- **What the fix will surface.** Siblings in the same pattern that the change forces a decision on, such as a
  stricter check that also flags a neighbour. Say whether deciding them is in scope.

Scope rule: steps contain only what the ticket's description and acceptance criteria require. Anything else is a
gotcha that names itself as a follow-up.

## 4. Recommend

For each open question in the ticket ("design considerations", "open questions", "for the developer to resolve"),
write one recommendation and its reason in one or two sentences, marked as the developer's call. Link the gotcha a
recommendation depends on.

## 5. Build the page

First call `Artifact` with `action: "quickstart"` and `intent: "other"`, once per new artifact. Then start from
`.claude/skills/task-explainer/template.html`. Keep its `<style>` and `<script>` verbatim, replace every
placeholder, set `lang` on `.page`, and delete the guide comments.

Put the sections in this order. Drop a section that would be empty; never pad one.

| Section | Content |
| --- | --- |
| Header | Eyebrow (key · type · status pill), title, a lede of one or two sentences (the problem and the fix), and meta links: the ticket, parent epic, related issues with their state, reporter, "Checked against origin/main on <date>" |
| Summary | The problem in two to four plain sentences. Facts: today's exposure, business goal, technical goal |
| Glossary | 5 to 8 terms the reader needs, in the project's words (the project's own glossary wins, if it has one) |
| How it works today | A `.flow` of the real call path, one node per hop, with a pill wherever it goes wrong |
| Problem sections | One per distinct problem, with an `h2 .tag` "Problem N". Add a diagram where relationships matter: an SVG map for actors and tenants, a table for "which input leads to what", a `.files` list for scattered literals |
| How it should work | The same flow after the change, plus a `.branch` for the outcomes |
| Acceptance criteria | Paraphrased plainly, in `.criteria` |
| Steps | In `.steps`, with a unique `data-storage-key` (`<key>-explainer-<lang>`). In order: branch from origin/main, files to read, preconditions to verify, red tests, code changes, docs and ADR. One action per step, with paths. A snippet only where the shape matters |
| Gotchas | `.gotcha` cards from step 3 |
| Decisions | A table of question and recommendation |
| Out of scope | Taken from the ticket |
| Sources | The ticket, ADRs and files read. The footer says which date's origin/main the line numbers come from |

Writing:

- Use plain language and short sentences. Define each piece of jargon once in the glossary, then use it.
- Use real names only: real paths, functions, scopes, error codes and line numbers. Label any hypothetical actor
  (a partner that does not exist yet) as hypothetical on the diagram itself.
- Show status with pills (`.pill-ok`, `.pill-bad`, `.pill-warn`), never with emoji.
- Put the diagram's content in words in the paragraph next to it. Give every SVG a `<title>`.
- Titles: English `<KEY> explained`, Russian `Разбор <KEY>`. Russian copy uses «ёлочки» quotes and keeps
  identifiers in Latin script.

## 6. Publish

- Write the page to `.claude-tmp/tasks/<KEY>/<KEY>.explainer.html`, or `<KEY>.explainer.ru.html` with `--ru`. The
  folder is local and never committed (`implement-task` Phase 3 says how to keep it ignored); create it if it is
  missing.
- Look in `.claude-tmp/tasks/<KEY>/artifacts.md` for `explainer-en: <url>` (or `explainer-ru`). If the line exists
  and `--new` is not set, `Artifact` `action: "read"` that URL, then publish with `url` to update it in place.
  Otherwise publish a new artifact with `icon: "map"` and a one-sentence `description`.
- If this session offers a preview, take one look and fix what it shows. Do not loop.
- Record the URL in `artifacts.md` as `explainer-<lang>: <url> (<date>)`. Keep one line per kind and language:
  replace the existing line rather than adding another.

## 7. Reply

Put the link first, then three to six bullets: what is on the page, each gotcha in one line, and any ticket claim that
did not match the code. Do not paste the page's content into chat. Say the page is private and is shared from its
Share menu. Do not post the link to chat, the ticket or the PR unless asked.
