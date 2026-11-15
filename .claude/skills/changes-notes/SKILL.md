---
name: changes-notes
description: Publish a plain-language "changes notes" page for a task's PR, for the author and the reviewers. The page covers what changed and why, before-and-after diagrams, the change grouped by purpose with links to the code at the PR head, and what it affects (behaviour and API contract, data and migrations, configuration, operations, rollback). It also covers the decisions taken, risks and follow-ups. It is built from the diff, the PR, CI, the ticket and the task's local notes. Its companion is testing-notes, which covers how the PR was tested. English by default; `--ru` writes the page in Russian. Use when the user asks for changes notes, a "what changed" page, a walkthrough of the PR, or an explanation of the finished change.
user-invocable: true
argument-hint: "[KEY | PR number | PR url] [--ru] [--new]"
---

# Changes notes for a PR

The page answers one question for someone who has not read the diff: **what did this PR change, and what does that
affect?** Write it in plain language, with a link to the code for every claim. How the change was tested belongs to
the companion skill `testing-notes`, and the two pages link to each other.

Input: a task key, a PR number or a PR URL. With none, take the key from the current branch name
(`PROJ-123-short-slug` gives `PROJ-123`) and use that branch's open PR. If the key has several PRs (a companion
repo, a split change), use the one in this repo and link the others.

Flags:

- `--ru`: write the page copy in Russian. The default is English. In both languages, keep code identifiers, paths,
  error codes, routes and check names verbatim.
- `--new`: publish a separate artifact instead of updating the one already recorded for this key and language.

The chat reply follows the language of the user's message, not the flag.

The skill is read-only toward the PR, the tracker and chat: no commits, PR edits, review comments, ticket transitions
or posts. It offers text for the PR description, and adds it only when the user says yes (step 5). The page uses
`.claude/skills/task-explainer/template.html`.

## 1. Gather

Run independent reads in parallel. Use the `gh` CLI for GitHub; it works whether or not a GitHub connector is up.

| Source | How |
| --- | --- |
| PR | `gh pr view <n> --json number,title,url,state,isDraft,baseRefName,headRefName,headRefOid,body,files,commits,reviewDecision` |
| Repo | `gh repo view --json nameWithOwner`, for the code links |
| Diff | `gh pr diff <n>`. Read all of it. List generated files (codegen output, lockfiles, baselines, baked assets) without explaining them |
| Head code | `git fetch -q origin <headRefName>`, then `git show "<headRefOid>:<path>"` for line numbers that match the PR |
| CI | `gh pr checks <n>`: failing and pending checks by name |
| Ticket | Through the tracker's tools: the description, the acceptance criteria, the out-of-scope list and the comments |
| Task folder | `.claude-tmp/tasks/<KEY>/`: the plan (`<KEY>.md`, its `## Decisions` and `## Log`), the handoff (`<KEY>.handoff.md`: `Rollout`, `Risks`, `Decisions to confirm`, `Follow-ups`), `<KEY>.follow-ups.md`, review notes, `artifacts.md` |
| Explainer | If `artifacts.md` has an `explainer-*` line, read it with `Artifact` `action: "read"`. Reuse its glossary, and its "How it works today" flow as the Before. Answer each of its Decisions rows with what was actually chosen |
| Decisions on record | ADRs or design docs the diff adds or amends, and the project's dated decision notes if it keeps them |
| Screenshots | `.claude-tmp/tasks/<KEY>/evidence/evidence.md` for screens the change makes visibly different |
| Structure | For a refactor or a change that moves files across modules, ask the project's architect agent (if it has one, e.g. `.claude/agents/architect.md`) for the module map before and after |
| Companion PRs | Any PR the body or handoff links, such as one in an infrastructure repo: title, state, what it changes |

A missing task folder or ticket is not a blocker. Build what you can from the PR and the diff, and say on the page
which source was missing.

## 2. Check every claim against the diff

- **Behaviour.** Every behavioural claim on the page needs the code that does it (a head `path:line`). A claim in the
  PR body or the handoff with no code behind it is shown as unverified, or left out.
- **Scope.** A changed file that the ticket does not explain is either support the change needs (say why) or scope
  creep. Flag scope creep under Risks.
- **"No change" is a finding.** For each line of "What it affects", look for the change before writing "no change":
  - the API schema or contract files;
  - migrations and the database schema;
  - configuration and environment keys, and `.env.example`;
  - CI workflows, scripts and logging.
- **CI.** A red or pending check gets a header pill and a line under Risks. Do not leave it out.

## 3. Build the page

First call `Artifact` with `action: "quickstart"` and `intent: "other"`, once per new artifact. Then start from the
template:

- Keep its `<style>` and `<script>` verbatim.
- Replace every placeholder.
- Set `lang` on `.page`.
- Delete the guide comments and every component the page does not use.

Put the sections in this order. Drop a section that would be empty; never pad one.

| Section | Content |
| --- | --- |
| Header | Eyebrow (key · PR #n · state pill for draft, open or merged · CI pill), title, a one-sentence lede of what changed, and meta links: PR, ticket, the `testing-notes` page if `artifacts.md` has a `testing-<lang>` line, `base ← head`, commit count, "Code links at `<short sha>`" |
| In short | Three to five plain sentences: what was missing or wrong, what happens now, what deliberately did not change. Facts as `.fact-num`: files changed (+/−), modules touched, migrations added |
| Before and after | `.compare` holding two `.flow` diagrams of the behaviour, or of the module structure for a refactor. Reuse the explainer's flow as the Before when it exists. Put each diagram's content in words next to it |
| What changed, by area | One `.area` per purpose, such as "Validation rules", "Storage", "Logging", "Tests" or "Docs". In each: why it changed in one or two sentences, then `.files` with +/− counts and each file linked to the code at the head SHA. Group by purpose, not by directory |
| What it affects | A short table with five rows: behaviour and API contract, data and migrations, configuration and environment, operations (logs, CI, scripts, dependencies), rollback (what the previous build does with anything the new one wrote). Each row says what changes for whom, or "No change" explicitly |
| Decisions | A table of question, what was chosen, why, and the rejected alternative, with links to the ADR or design note. Note where it differs from the explainer's recommendation |
| Risks and follow-ups | From the handoff, CI state and the scope flags from step 2. Each follow-up gets its triage pill: pending, implement now, draft ticket or dropped |
| Sources | The PR, the ticket, the explainer, ADRs and files read. The footer says which head SHA the code links come from |

Writing:

- **Plain language.** Short sentences, everyday words and the project's own terms. Explain a technical term the
  first time it appears, or use the glossary.
- **Code links.** `https://github.com/<owner>/<repo>/blob/<headSha>/<path>#L<a>-L<b>` for every behavioural claim.
  Never link to a branch name, which moves. Do not paste large diffs. Use a short before-and-after snippet only where
  the shape is the point.
- **Screenshots.** A visible change gets the screenshot from `evidence/` as a `figure.shot` (a downscaled `data:`
  URI with alt text and a caption), next to the area it belongs to.
- **Status.** Pills, never emoji.
- **Titles.** English `<KEY> changes`; Russian `Изменения <KEY>`. Russian copy uses «ёлочки» quotes and keeps
  identifiers in Latin script.

## 4. Publish

- Write the page to `.claude-tmp/tasks/<KEY>/<KEY>.changes.html`, or `<KEY>.changes.ru.html` with `--ru`.
- Look in `.claude-tmp/tasks/<KEY>/artifacts.md` for `changes-<lang>: <url>`.
  - If the line exists and `--new` is not set, read that URL with `Artifact` `action: "read"`, then publish with
    `url` to update it in place. That is the normal path after new commits: the head SHA in the header and in every
    link moves with it.
  - Otherwise publish a new artifact with `icon: "review"` and a one-sentence `description`.
- If this session offers a preview, take one look and fix what it shows. Do not loop.
- Record the URL in `artifacts.md` as `changes-<lang>: <url> (<date>, <short sha>)`.

## 5. Reply

- **Link and summary.** Put the link first. Then give one line on the scope (areas and files), the "What it
  affects" rows that are not "No change", and the CI state.
- **Sharing.** Say the page is private and is shared from its Share menu.
- **PR description.** Offer this block for the PR description:

  ```markdown
  **Notes:** [Changes](<changes url>) · [Testing](<testing url>)
  ```

  Leave out a page that does not exist yet. Show the exact text. Add it with `gh pr edit` only after the user says
  yes. Posting the link anywhere else (chat, the ticket) is outward-facing as well: do it only when asked.
