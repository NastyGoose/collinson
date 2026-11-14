---
name: pr-walkthrough
description: After a task's PR is open, explain what changed on a published artifact page for reviewers and QA. The page shows before-and-after diagrams of the behaviour, the change grouped by area with the reason for each, every acceptance criterion mapped to the code and test that prove it, the decisions taken, how to verify by hand, rollout and rollback, risks and follow-ups. It is built from the diff, the PR, CI, the ticket and the task's local handoff. English by default; `--ru` writes the page in Russian. Use when the user asks for a PR walkthrough, a "what changed" page, a page for reviewers or QA, or an explanation of the finished change.
user-invocable: true
argument-hint: "[KEY | PR number | PR url] [--ru] [--new]"
---

# Walk reviewers and QA through a PR

Input: a task key, a PR number or a PR URL. With none, take the key from the current branch name
(`PROJ-123-short-slug` gives `PROJ-123`) and use that branch's open PR. If the key has several PRs (a companion
repo, a split change), use the one in this repo and link the others.

Flags:

- `--ru`: write the page copy in Russian. The default is English. In both languages, keep code identifiers, paths,
  error codes, routes and check names verbatim.
- `--new`: publish a separate artifact instead of updating the one already recorded for this key and language.

The chat reply follows the language of the user's message, not the flag.

The skill is read-only. It makes no commits, PR edits, review comments or ticket transitions. Merging and
writing ready-for-test notes belong to other skills (`prepare-for-testing`). The page uses the
`task-explainer` page template, `.claude/skills/task-explainer/template.html`.

## 1. Gather

Run independent reads in parallel. Use the `gh` CLI for GitHub; it works whether or not a GitHub connector is up.

| Source | How |
| --- | --- |
| PR | `gh pr view <n> --json number,title,url,state,isDraft,baseRefName,headRefName,headRefOid,body,files,commits,reviewDecision` |
| Diff | `gh pr diff <n>`. Read all of it. List generated files (codegen output, lockfiles, baked assets) without explaining them |
| Head code | `git fetch -q origin <headRefName>`, then `git show <headRefOid>:<path>` for line numbers that match the PR |
| CI | `gh pr checks <n>`: failing and pending checks by name |
| Ticket | As in `task-explainer`: the acceptance criteria and the out-of-scope list |
| Task folder | `.claude-tmp/tasks/<KEY>/`: `<KEY>.md` (`## Decisions`, `## Log`), `<KEY>.handoff.md` (`Verify by hand`, `Do by hand`, `Rollout`, `Risks`, `Decisions to confirm`, `Follow-ups`, `Automated coverage`), `<KEY>.follow-ups.md`, `artifacts.md` |
| Explainer | If `artifacts.md` has an `explainer-*` line, `Artifact` `action: "read"` it. Reuse its glossary and its "How it works today" flow as the Before. Answer each of its Decisions rows with what was actually chosen |
| Companion PRs | Any PR the body or handoff links, such as one in an infrastructure repo: title, state, what it changes |

## 2. Check every claim against the diff

- **Acceptance criteria.** For each one, find the code that meets it (head `path:line`) and the test that proves it
  (spec path and test name). The verdict is one of: met (code and test), met but untested (code only), partial, or
  not met. Never upgrade a verdict because the PR body or the handoff says so.
- **Other claims.** Any claim in the PR body or the handoff, such as "existing behaviour unchanged", needs evidence:
  the test that pins it, or the unchanged path. Without evidence, show it as unverified.
- **CI.** A red or pending check gets a header pill and a line under Risks. Do not leave it out.
- **Scope.** A changed file that no criterion explains is either support the change needs (say why) or scope creep.
  Flag scope creep under Risks.

## 3. Build the page

First call `Artifact` with `action: "quickstart"` and `intent: "other"`, once per new artifact. Then start from the
template. Keep its `<style>` and `<script>` verbatim, replace every placeholder, set `lang` on `.page`, and delete the
guide comments.

Put the sections in this order. Drop a section that would be empty; never pad one.

| Section | Content |
| --- | --- |
| Header | Eyebrow (key · PR #n · state pill for draft, open or merged · CI pill), title, a one-sentence lede of what changed, and meta links: PR, the ticket, the explainer if any, `base ← head`, commit count, "Line numbers from `<short sha>`" |
| Summary | Two to four sentences: what was wrong, what happens now, what deliberately did not change. Facts as `.fact-num`: files changed (+/−), tests added, criteria met with a test |
| Before and after | `.compare` holding two `.flow` diagrams. Reuse the explainer's flow as the Before when it exists |
| What changed, by area | One `.area` per purpose, such as "Validation rules", "Intake", "Tracing" or "Tests". In each: why it changed, then `.files` with +/− counts and the key head line numbers. Group by purpose, not by directory |
| Criteria and evidence | A table of criterion, where it is met (`path:line`), the proving test, and a verdict pill |
| Decisions made | A table of question, what was chosen, why, and the rejected alternative. Note where it differs from the explainer's recommendation |
| How to verify | For QA: ordered `.steps` from `Verify by hand`, each with its command, URL or screen and the expected result. Use a `data-storage-key` of `<key>-walkthrough-<lang>`. Then automated coverage, from the handoff and CI |
| Rollout and rollback | Preconditions from `Do by hand` before deploy, the ordered rollout, and the rollback: what the previous build does with what the new one wrote, and what cannot be undone |
| Risks | From the handoff, plus CI state and any scope flags from step 2 |
| Follow-ups | From the handoff, each with its triage pill: pending, implement now, draft ticket, or dropped |
| Sources | The PR, the ticket, the explainer, and files read. The footer says which head SHA the line numbers come from |

Writing:

- Reviewers read the page next to the diff. Cite the head `path:line` for every behavioural claim. Do not paste large
  diffs; use a short before-and-after snippet only where the shape is the point.
- Use plain language and short sentences. Show status with pills, never with emoji. Put each diagram's content in
  words next to it.
- Titles: English `<KEY> walkthrough`, Russian `Изменения <KEY>`. Russian copy uses «ёлочки» quotes and keeps
  identifiers in Latin script.

## 4. Publish

- Write the page to `.claude-tmp/tasks/<KEY>/<KEY>.walkthrough.html`, or `<KEY>.walkthrough.ru.html` with `--ru`.
- Look in `.claude-tmp/tasks/<KEY>/artifacts.md` for `walkthrough-en: <url>` (or `walkthrough-ru`). If the line exists
  and `--new` is not set, `Artifact` `action: "read"` that URL, then publish with `url` to update it in place. That
  is the normal path after new commits: the header's head SHA moves with it. Otherwise publish a new artifact with
  `icon: "review"` and a one-sentence `description`.
- If this session offers a preview, take one look and fix what it shows. Do not loop.
- Record the URL in `artifacts.md` as `walkthrough-<lang>: <url> (<date>, <short sha>)`.

## 5. Reply

Put the link first. Then give the verdict count ("6 of 7 criteria met with a test"), name each criterion that is not
met, partial or untested, and state the CI result. Say the page is private and is shared from its Share menu. Posting
the link to the PR, chat or the ticket is outward-facing: do it only when asked, and show the exact text first.
