---
name: watch-pr-checks
description: Use when asked to watch, babysit or keep an eye on a PR's CI, to "tell me when it's green/red", to "add a job to watch the checks", or right after pushing a PR branch whose checks are still running while the user waits on the result.
user-invocable: true
argument-hint: "[PR number | branch] [--repo owner/repo] [--interval 15m]"
allowed-tools: Bash, Read, TaskStop
---

# Watch a PR's checks

One background job waits until every check on the PR's head has finished, then one report: green, or red with
the failing checks and their links. Pick the interval from how long CI really takes: about a third of a typical run
(`gh run list --limit 5 --json name,createdAt,updatedAt`), never under one minute, and **15 minutes** when runs take
20 minutes or more. Polling every few seconds is always too fast. An interval in the arguments overrides it. Pass
`--repo owner/repo` for a PR outside the current repo.

If the session has its own PR monitoring (an app feature that watches CI and wakes the session), use that instead
and start no job.

## 1. Preflight, once in the foreground

```bash
gh pr view <pr> --json number,headRefOid,mergeable,mergeStateStatus,isDraft
gh pr checks <pr> --json name,state --jq 'group_by(.state)|map({(.[0].state):length})|add'
```

- `mergeable` is `CONFLICTING`: `pull_request` workflows do not start, so no check will ever appear. Stop and
  tell the user the branch needs the base branch merged in first.
- Every check has already finished: report now and start no job.
- A watcher for this PR is already running in the session: stop it with `TaskStop` first. One watcher per PR.

## 2. Start the job

Bash with `run_in_background: true` and a timeout of several CI runs (at most two hours, `7200000`), so the job ends
itself. Never poll in the foreground or with a short loop.

```bash
PR=123 INTERVAL=900   # add --repo owner/repo to every gh call for another repo
# Right after a push the checks may not be registered yet, and --watch would exit at once.
for i in $(seq 1 10); do
  n=$(gh pr checks $PR --json name --jq length 2>/dev/null)
  [ "${n:-0}" -gt 0 ] && break
  sleep 60
done
gh pr checks $PR --watch --interval $INTERVAL >/dev/null 2>&1; echo "watch exit=$?"
gh pr view $PR --json headRefOid --jq '"head=\(.headRefOid[0:8])"'
gh pr checks $PR --json name,state --jq 'group_by(.state)|map({(.[0].state):length})|add'
gh pr checks $PR --json name,state,link \
  --jq '.[]|select(.state!="SUCCESS" and .state!="SKIPPED")|"\(.state)\t\(.name)\t\(.link)"'
```

Tell the user in one line what is watched, how often, and for how long at most.

## 3. Report when the job notifies

Read the job's output and report facts only:

- **Green:** every check passed on `<head sha>`, with the passed and skipped counts.
- **Red:** each failing check with its link. Open the first failure's log
  (`gh run view <run-id> --log-failed | tail -80`) and say in one or two lines what failed. Do not fix or
  re-run anything unless the user asks.
- **Timed out or still pending:** name the checks still running and offer to restart the watch.
- **The head sha differs from the preflight's:** someone pushed during the watch, so say which head the result is
  for.

## Common mistakes

| Mistake | Instead |
| --- | --- |
| Polling every few seconds, or a foreground loop | One background job at an interval sized to the CI run |
| Watching a PR that conflicts with its base | Preflight catches it; no checks will start |
| Calling it green from the exit code alone | Read the state summary, where skipped and neutral show separately |
| Starting a second watcher on the same PR | `TaskStop` the old job first |
