---
name: testing-notes
description: Publish a plain-language "testing notes" page for a task's PR. It shows how the work was tested against each acceptance criterion, with evidence a reviewer can inspect. Evidence means links to the proving tests at the PR head, trimmed command output and logs, API request and response captures, and screenshots. Each criterion gets a verdict that is never based on evidence the skill did not see itself. The page also covers the test runs (local and CI), manual checks, and gaps. Its companion is changes-notes, which covers what changed. English by default; `--ru` writes the page in Russian. Use when the user asks for testing notes, test evidence, "how was this tested", QA notes, or proof that a PR meets its acceptance criteria.
user-invocable: true
argument-hint: "[KEY | PR number | PR url] [--rerun] [--ru] [--new]"
---

# Testing notes for a PR

The page answers one question for a reviewer: **how do we know this PR does what the ticket asks?** Each acceptance
criterion gets the tests and evidence that prove it and a verdict. What changed, and why, belongs to the companion
skill `changes-notes`, and the two pages link to each other.

Input: a task key, a PR number or a PR URL. With none, take the key from the current branch name
(`PROJ-123-short-slug` gives `PROJ-123`) and use that branch's open PR.

Flags:

- `--rerun`: run the project's test commands locally first and use that output as evidence. Without it, use the
  latest CI run for the PR head plus the local evidence already collected.
- `--ru`: write the page copy in Russian. The default is English. Keep code identifiers, paths, test names, commands
  and output verbatim.
- `--new`: publish a separate artifact instead of updating the one already recorded for this key and language.

The chat reply follows the language of the user's message, not the flag.

The skill is read-only toward the PR, the tracker and chat. It runs tests only with `--rerun`, and only the
project's own commands against the local stack. It offers text for the PR description and adds it only when the user
says yes (step 6). The page uses `.claude/skills/task-explainer/template.html` and its `.evidence`, `.log` and
`figure.shot` blocks.

## 1. Gather

Run independent reads in parallel.

| Source | How |
| --- | --- |
| PR | `gh pr view <n> --json number,title,url,state,isDraft,headRefName,headRefOid,body,files` and `gh repo view --json nameWithOwner` |
| Criteria | The ticket's acceptance criteria, through the tracker's tools. If the project keeps acceptance scenarios elsewhere (an implementation plan, a spec), add the ones this ticket covers |
| Tests in the diff | `gh pr diff <n>`: the test files added or changed, and each test's name and line at the head SHA (`git show "<headRefOid>:<path>"`). A PR with no tests (docs, CI config) is proven by inspection: link the files and lines that deliver each criterion |
| CI | `gh pr checks <n>`, then `gh run list --commit <headRefOid> --json databaseId,name,conclusion,url`. Per relevant job, `gh run view <id> --log` (or `--log-failed`), trimmed to the lines that matter |
| Handoff | `.claude-tmp/tasks/<KEY>/<KEY>.handoff.md`: `Automated coverage` and `Verify by hand`. `Do by hand` lists the author's actions, not checks. With no handoff, take the manual checks from the PR body's test plan |
| Evidence | `.claude-tmp/tasks/<KEY>/evidence/evidence.md` and the files it lists (from `verify-handoff`): screenshots, captures, probe outputs |
| Commands | The project's test, lint and typecheck commands, from `CLAUDE.md`, the README, package scripts or the CI config |
| Companion page | `artifacts.md`: the `changes-<lang>` URL, for the header link. Without one, leave the link out |

With `--rerun`:

1. Start what the tests need (for example the database), the way the README says.
2. Run each test command once.
3. Save each output to `.claude-tmp/tasks/<KEY>/evidence/runs/<command-slug>.txt` with the command, the head SHA,
   the date and the exit status on top.

Never run live-provider or production checks unless the user asks.

A missing ticket, handoff or evidence folder is not a blocker. Build the page from what exists, and name what was
missing under "Gaps and risks".

## 2. Map criteria to evidence and judge

For each acceptance criterion:

1. Restate it in plain words. A criterion that bundles several claims ("document X, Y and Z") is split into one line
   per claim inside its card, and each line gets its own verdict. The card's verdict is the weakest of them. With
   the ticket out of reach, take the criteria from the PR body and say so in the lede.
2. Find the tests that prove it:
   - the spec path, the test name, and a link to that line at the head SHA;
   - prefer tests that the diff adds or changes, then existing tests that cover the behaviour.
3. Find the evidence that those tests ran and passed at this head:
   - a CI job result for the head SHA;
   - or a `--rerun` output;
   - or an evidence file for a manual check.
4. Give exactly one verdict:

| Verdict | Pill | When |
| --- | --- | --- |
| proven | `pill-ok` | A test that exercises the criterion passed at this head, in CI or in a run you saw. For a deliverable that is a document or configuration, you read it at the head and it says what the criterion asks, accurately (method: inspection) |
| proven by hand only | `pill-warn` | No automated test, but an evidence file shows the manual check passed |
| partial | `pill-warn` | Part of the criterion is proven; say which part is not |
| not proven | `pill-bad` | No passing test or evidence seen, a failing or pending run, or a manual item with no evidence file |

Rules for verdicts:

- **Your own evidence only.** A verdict rests only on what you saw yourself. Never take the PR body, the handoff or
  a commit message's word for it.
- **Pending or red runs.** A run that is pending or failed never yields "proven". Say so, and name the failing job.
- **Manual checks without evidence.** A manual check with no evidence file is "not proven". Add "run
  `verify-handoff`" next to it.
- **Evidence from another head.** Evidence from another commit counts only if the code and tests it exercises are
  the same there. Say why, for example "later commits change only docs" or "the merge commit has the same tree".
  - Older commit: check that the commits since then cannot affect it.
  - Newer commit, such as `main` after the merge: check that neither the test nor the code it covers changed in
    between (`git diff <head> <newer> -- <paths>`). Otherwise list the run under "Test runs" as context only, never
    as proof.

## 3. Evidence rules

- **Excerpts.**
  - Trim to the lines that show the result: the summary line, the relevant test names, the failing assertion.
  - Put the command and its exit status on top, in `.log-cmd`.
  - Never paste a whole log.
- **Redaction.** Remove tokens, passwords and keys, credentials inside connection strings, email addresses and other
  personal data. Use `<redacted>` in their place. Check every excerpt for this before you build the page.
- **API captures.** Show the request and the response, pretty-printed and trimmed, with the endpoint and the status.
- **Screenshots.**
  - Embed them as downscaled `data:` URIs, at most about 1200 px wide.
  - Give each one alt text and a caption that says what to look at.
  - Keep the whole page well under a few MB.
- **Probes.** Deliberate-failure checks (a probe that must fail, then passes after the fix) are strong evidence.
  Show the before and after outputs side by side.

## 4. Build the page

First call `Artifact` with `action: "quickstart"` and `intent: "other"`, once per new artifact. Then start from the
template:

- Keep its `<style>` verbatim.
- Keep its `<script>` verbatim when the page has a `.steps` list; otherwise delete it, because it only drives
  `.steps`.
- Replace every placeholder.
- Set `lang` on `.page`.
- Delete the guide comments and every component the page does not use.

Put the sections in this order. Drop a section that would be empty; never pad one.

| Section | Content |
| --- | --- |
| Header | Eyebrow (key · PR #n · state pill · overall verdict pill such as "6 of 7 criteria proven"), title, a one-sentence lede, and meta links: PR, ticket, the `changes-notes` page when it exists, "Evidence at `<short sha>`" |
| In short | Two to four plain sentences: what was tested, where (local, CI, by hand), and the gaps. Facts as `.fact-num`: criteria proven, tests added, CI result |
| Criteria and evidence | One `.evidence` card per criterion, as in step 2, with its `.log` excerpts and `figure.shot` screenshots |
| Test runs | A table of each command or CI job: result, duration, where it ran, and a link to the CI run or the saved output |
| Manual checks | From `Verify by hand`, or from the PR's test plan without a handoff: the steps, the observed result and the evidence file. A check without an evidence file says "no evidence". Use `.steps` with a `data-storage-key` of `<key>-testing-<lang>` when a reader should repeat them |
| Gaps and risks | What was not tested and why, flaky or skipped tests by name, and sources that were missing |
| Sources | The PR, the ticket, the CI runs and the evidence files read. The footer says which head SHA the links and runs come from |

Writing:

- Plain language and short sentences; keep test names, commands and output verbatim.
- Pills for status, never emoji.
- Titles: English `<KEY> testing`; Russian `Тестирование <KEY>`, with «ёлочки» quotes and identifiers in Latin
  script.

## 5. Publish

- Write the page to `.claude-tmp/tasks/<KEY>/<KEY>.testing.html`, or `<KEY>.testing.ru.html` with `--ru`.
- Look in `.claude-tmp/tasks/<KEY>/artifacts.md` for `testing-<lang>: <url>`.
  - If the line exists and `--new` is not set, read that URL with `Artifact` `action: "read"`, then publish with
    `url` to update it in place. That is the normal path after new commits.
  - Otherwise publish a new artifact with `icon: "check"` and a one-sentence `description`.
- If this session offers a preview, take one look and fix what it shows. Do not loop.
- Record the URL in `artifacts.md` as `testing-<lang>: <url> (<date>, <short sha>)`.

## 6. Reply

- **Link and verdicts.** Put the link first. Then give the verdict count, name each criterion that is not proven or
  only partly proven, and state the CI result for the head.
- **Sharing.** Say the page is private and is shared from its Share menu.
- **PR description.** Offer the same block `changes-notes` offers:

  ```markdown
  **Notes:** [Changes](<changes url>) · [Testing](<testing url>)
  ```

  Show the exact text, and add it with `gh pr edit` only after the user says yes. Posting the link anywhere else is
  outward-facing too: do it only when asked.
