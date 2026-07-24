---
name: bugbot-babysit
description: Babysit a PR's Cursor Bugbot review cycle until every finding is resolved. Auto mode triages, fixes, and replies autonomously in a loop; assisted mode waits for findings and runs the interactive proposal flow each round.
context: current
allowed-tools: Bash, Read, Grep, Glob, AskUserQuestion
---

# Bugbot Babysit

Stay on a PR through repeated bugbot review rounds — each push triggers a fresh review, which can surface fresh findings — until there are no unresolved bugbot comments left.

## Inputs

- **PR**: number, URL, or `owner/repo#number`
- **Mode**: `auto` or `assisted`. If the user didn't specify, ask once up front.
  - **auto** — loop autonomously: triage, fix, reply, push, wait, repeat until clean
  - **assisted** — wait for findings, then run the `bugbot-triage` proposal flow (approve / challenge / skip per finding) each round

## The loop

Each round:

### 1. Wait for bugbot to review the current head

Bugbot posts a review for each pushed commit; its comments end with `Reviewed ... for commit <sha>`. The head has been reviewed when a bugbot review or finding references the current head SHA, or a new bugbot review appears dated after the head commit's push.

Poll rather than assume:

```bash
sleep 90
gh api repos/OWNER/REPO/pulls/PR/reviews --paginate \
  -q '[.[] | select(.user.login == "cursor[bot]")] | last | {submitted_at, commit_id}'
```

Compare `commit_id` against `git rev-parse HEAD` (or the tool output's `head`). Poll every ~90s. If no review lands after ~15 minutes, stop polling and check in with the user — bugbot may be disabled for the repo or backed up.

### 2. Fetch unresolved findings

Use the bugbot `fetch_unresolved_comments` tool. **Exit condition**: bugbot has reviewed the current head AND the unresolved count is 0 — report success and stop.

### 3. Resolve the findings

**Auto mode** — for each finding, investigate exactly as `bugbot-triage` Step 2 prescribes (read the code, trace the claim, check staleness), then:

- verdict **real** with confidence ≥ 70 → fix it, following repo conventions and running the repo's verification commands
- verdict **stale** / **by-design** / **wontfix** with confidence ≥ 70 → reply on the thread with the specific evidence
- confidence < 70 → do NOT act; collect it and surface all low-confidence findings to the user at the end of the round, then continue with the rest

Commit fixes per the repo's commit style and push. Never force-push; never touch findings authored by humans.

**Assisted mode** — run the full `bugbot-triage` flow: per-finding proposal with verdict + confidence, user chooses approve / challenge / skip. Execute approved actions, then push any resulting commits.

### 4. Round report, then loop

After each round, post a one-paragraph status: findings handled (fixed / replied / skipped), commits pushed, and that you're waiting on bugbot's next review. Then return to step 1 — a push means bugbot will re-review and may find new issues in the fixes themselves.

## Guardrails

- **Round cap**: after 5 rounds without reaching zero unresolved findings, stop and escalate to the user — a loop that long means the fixes are churning.
- Skipped findings (assisted) and low-confidence findings (auto) don't count as resolved: report them as the remainder when the loop ends, so "done" is never silently redefined.
- If the working tree has changes you didn't make, stop and ask before committing anything.
- Replies must carry evidence (file:line, commit sha, or invariant) — a reply that just waves the finding away invites the same finding next round.
