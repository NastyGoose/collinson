---
name: reviewing-teammate-prs
description: Use when asked to review a teammate's pull request (one the user did not author) and prepare the review as a draft the user approves before it is posted — "make review", "review PR 796 and draft it for me", "check the first PR for the ticket too", "prepare a doc with the review", including stacked PRs of one ticket.
---

# Reviewing teammates' PRs

## Overview

The user posts the review under their own name, so the draft must read in their voice: warm, humble, specific, and
checked against the code. Nothing is posted until the user says go.

If the user authored the PR, use `self-review-pr` instead.

## Steps

1. Read the PR (author, base, stacked PRs of the same ticket, existing reviews, CI) and the ticket's acceptance
   criteria. When the user says "check the other PR too" or "combine", review every PR of the stack.
2. Run `/code-review <N>` per PR in the background; read the diff and map the acceptance criteria meanwhile.
3. Verify every finding at the PR head before it enters the draft. Keep it out, with a one-line reason, when it is
   fixed by another PR of the stack, a choice the PR description already explains, older than the ticket (it
   becomes a proposed follow-up), style only, or settled by a team decision recorded in memory or the project docs.
4. Draft: a doc when the user asks for one, otherwise fenced text blocks in chat. Sections: how to use (a
   table PR · what it does · verdict · comment count), one section per PR (verdict line, review summary, comments),
   left out (table PR · finding · why), proposed follow-ups (checklist).
5. Post only after the user approves: `gh api repos/<owner>/<repo>/pulls/<N>/reviews` with `commit_id` = the head
   SHA, `event` (`APPROVE` | `COMMENT` | `REQUEST_CHANGES`), `body`, and `comments[]` of `{path, line, side: "RIGHT",
   body}`. Re-fetch the head first; a new push can move the lines.

## The review contract

**Review summary** = a short line of praise ("Nicely done, this is a clean first step!", "Great work on this one!") +
one or two sentences on what you checked and found sound + how many comments there are and whether any blocks.

**Each inline comment** =
1. A label: optional, nit or question.
2. Humble framing: "If I'm reading this right", "I might be missing something, but", "I think".
3. The concrete case: the input, what happens, and where.
4. The suggestion as a question: "Would … work here?", "What do you think?"
5. For optional ones, an easy way out: "feel free to skip", "happy to leave it".

Match the user's own voice where earlier reviews of theirs are available (`gh search prs --reviewed-by @me`); the
phrases above are the default tone.

**References are links with readable text.** The link text is a file name and line, or the name of the thing ("the
legacy forwarder", "the stamping migration"). Commit SHAs, migration timestamps and other opaque ids live only
inside URLs.

| Target | URL |
| --- | --- |
| A line in the PR diff | `https://github.com/<owner>/<repo>/pull/<N>/files#diff-<sha256 of path>R<line>` |
| A line outside the diff | `https://github.com/<owner>/<repo>/blob/<head SHA>/<path>#L<line>` |
| A file on the default branch | `https://github.com/<owner>/<repo>/blob/<default branch>/<path>` |

The anchor hash: `printf %s "<path>" | sha256sum | cut -d' ' -f1` (`shasum -a 256` on macOS).

In the draft, the line above each comment is the link to the line it will be posted on:
`**Comment 2, nit:** [parser.service.ts, line 442](<diff link>)`.

## Example

> Small one, and maybe better suited to the sad-path ticket. I might be missing something, but `splitCode` seems to
> ignore anything after a second colon. So a lone entry such as `AB01:FAST:x` would be accepted and stored as
> received. A plain code with the same shape passes intake too, but [the legacy forwarder refuses
> it](https://github.com/<owner>/<repo>/blob/<head SHA>/src/integration/legacy/forwarder.ts#L111), so this path looks
> like the only one where the malformed text would stick.
