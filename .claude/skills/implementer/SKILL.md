---
name: implementer
description: "Implement one GitHub issue that the architect skill produced. Use whenever the developer points at an issue and wants it built — \"#12 をやって\", \"issue 3 を実装して\", \"implement #7\", an issue URL, or \"start on the next issue\". Hands the issue to an Opus agent in an isolated git worktree, gets a PR opened, waits for CI, then hands the PR to the reviewer skill. Do not use for work that has no issue yet; send that to architect first."
---

# Implementer

## Why it works this way

The design was agreed in the issue. The implementation is deliberately handed
to a separate agent so that the main session stays the developer's
conversation partner and does not drift into making design calls while coding.
The agent works in its own worktree so the developer's checkout is untouched
and several issues can be in flight.

## Steps

### 1. Read the issue

```
gh issue view <N> --json number,title,body,url
```

Check that the body has a `To Implementer` section. If it does not, the issue
did not come through architect; stop and tell the developer to run architect
for it. If the 設計 section links a parent issue, read that too — it holds the
decision record the implementation must respect.

### 2. Spawn the implementation agent

Use the Agent tool with:

- `subagent_type`: `general-purpose`
- `model`: `opus`
- `isolation`: `worktree`

The prompt must contain the full issue body (and the parent's decision record
if any), plus these instructions, in this spirit:

```
You are implementing GitHub issue #<N> in this repository. The design has
already been decided by the developer; your job is to follow it, not to
improve on it.

<issue body>
<parent decision record, if any>

Rules:
- Implement only what 対応内容 and To Implementer describe. Nothing listed
  under "Out of scope" changes.
- Keep to the boundaries and interfaces in 実装が守る制約. If you find that
  the design as written cannot work, or you would need to make a design
  decision the issue does not cover, stop, do not choose, and report the
  question in your final message.
- Write the tests the issue asks for. Run the project's test and lint
  commands; do not open a PR with failures you know about.
- Code comments: default to none. Write one only when the code itself cannot
  tell the reader something they need right now — a non-obvious invariant, a
  constraint from outside the code, a deliberate oddity. Never describe what
  the code does, and never refer to history: no "previously", "changed from",
  "as decided in the issue". History lives in git log and the issue; a comment
  pointing at it is a debt that goes stale the moment the code moves.
- Commit on a branch named issue-<N>-<short-slug>, push it, and open a PR
  with `gh pr create`. The PR body starts with `Closes #<N>`, then a short
  summary, then a section "Deviations" listing anything you did differently
  from the issue and why (write "none" if none).
- End your final message with: the PR number, the branch name, and the
  Deviations section verbatim.
```

Wait for the agent to finish. Do not implement in the main session while
waiting.

### 3. Handle the agent's report

- If the agent stopped on a design question: relay the question to the
  developer as-is, and stop. The answer may need an issue update; that is the
  developer's call.
- If a PR was opened: note the PR number and the Deviations section. Any
  deviation goes into the reviewer's report later, so keep it.

### 4. Wait for CI

```
gh pr checks <PR> --watch --fail-fast
```

Run it with a generous timeout. Three outcomes:

- **No checks configured**: continue to review, and say so in the handoff.
- **Green**: continue to review.
- **Red**: CI failure is below the bar for review. Send the failing check
  names and log excerpt back to the same agent with SendMessage and ask it to
  fix and push. Wait again. If it is still red after that one retry, stop and
  show the developer the failure; do not loop.

### 5. Hand off to review

Invoke the `reviewer` skill with the PR number. Pass along the Deviations
section and whether CI ran.
