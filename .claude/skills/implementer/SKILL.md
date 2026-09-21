---
name: implementer
description: "Implement one GitHub issue that the architect skill produced. Use whenever the developer points at an issue and wants it built — \"#12 をやって\", \"issue 3 を実装して\", \"implement #7\", an issue URL, or \"start on the next issue\". Hands the issue to a Sonnet agent in an isolated git worktree, gets a PR opened, waits for CI, then hands the PR to the reviewer skill. Do not use for work that has no issue yet; send that to architect first."
---

# Implementer

## Why it works this way

The design was agreed in the issue. The implementation is deliberately handed
to a separate agent so that the main session stays the developer's
conversation partner and does not drift into making design calls while coding.
The agent works in its own worktree so the developer's checkout is untouched
and several issues can be in flight.

The issue can be rewritten or withdrawn while the agent works — the developer
or another session may edit it, close it, or change the parent it belongs to.
The guard script takes a copy before the agent starts, and that copy, not a
fresh read, is what the agent builds from and what the later checks compare
against. Reading fresh at every step would let the agent and the merge
decision see two different versions of the same issue.

## When an issue can start

An issue that names a parent is only ready once its predecessors in the
parent's `## 子 issue` list are done. The snapshot (see step 1 below)
already carries what that needs: `parent.body` holds the ordered list, and
`parent.children` gives every other child's current `state` (`OPEN` or
`CLOSED`) and `stateReason` (`COMPLETED`, `NOT_PLANNED`, or `null`). A
predecessor is done when its `state` is `CLOSED` and its `stateReason` is
`COMPLETED`.

Every child listed before this one in `parent.body` must be done, unless
the parent says in words, anywhere in its body, that this issue is
independent of the others (「他と独立です」 or similar). When the parent's
wording is unclear, treat the list as strict order: a predecessor that is
not done means this issue is not ready yet.

An issue with no parent (`parent` is `null` in the snapshot) has no
predecessors to check.

## Steps

### 1. Read the issue

Run the guard script's snapshot operation before anything else, including
before checking whether the issue is ready to start. The script does not
create its output folder, so make it first:

```
mkdir -p <scratchpad>/issue-guard
node .claude/skills/implementer/scripts/issue-guard.mjs snapshot <N> --dir <scratchpad>/issue-guard
```

On a non-zero exit, stop and show the developer the script's lines exactly
as printed; do not spawn the agent.

On success, the snapshot is at `<scratchpad>/issue-guard/issue-<N>.json`.
Its `body` field is the issue text, and, when the issue has a parent, the
`parent.body` field is the parent's decision record. These are the copies
to use from here on; do not fetch either with `gh issue view` again.

Apply the rule under "When an issue can start" above. If a predecessor
blocks it, stop and tell the developer which predecessor is still open.

Check that the body has a `To Implementer` section. If it does not, the
issue did not come through architect; stop and tell the developer to run
architect for it.

Save the `body` field to a scratchpad file and check its shape:

```
node .claude/skills/architect/scripts/check-issue.mjs <body.md>
```

If the check reports problems, the issue cannot hold the implementation to
the design. Stop and show the developer the output; repairing the issue is
architect's job. The one exception is an issue with no `## ケース` section at
all: build it from its `To Implementer` section as written, and say in the
handoff that it carried no cases.

### 2. Spawn the implementation agent

Use the Agent tool with:

- `subagent_type`: `general-purpose`
- `model`: `sonnet`
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
- Every line under 制約 binds you, in this issue and in the parent. If you
  find that the design as written cannot work, or you would need to make a
  design decision the issue does not cover, stop, do not choose, and report
  the question in your final message.
- Read the Tests section of .claude/skills/software-design-theory/SKILL.md
  before writing any test.
- Tests come first. Turn every case under ケース into a test, run them, and
  confirm each fails because the behaviour is missing, not because of a typo
  or a missing import that the implementation would not fix. Commit the tests
  alone. Then implement, and commit the implementation on top. If the issue
  has no cases, there is no test commit; the type check is the verification.
- A test asserts what the case says is seen, with the literal values from the
  case. Do not add tests the cases do not call for. If you believe a case is
  missing, say so in Deviations; do not invent it.
- Test names and descriptions say what is observed. No case ids, no issue
  numbers.
- Run every command under "Structural checks", and the project's test, type
  check, and lint commands. Do not open a PR with failures you know about.
- Code comments: default to none. Write one only when the code itself cannot
  tell the reader something they need right now — a non-obvious invariant, a
  constraint from outside the code, a deliberate oddity. Never describe what
  the code does, and never refer to history: no "previously", "changed from",
  "as decided in the issue". History lives in git log and the issue; a comment
  pointing at it is a debt that goes stale the moment the code moves.
- Commit on a branch named issue-<N>-<short-slug>, push it, and open a PR
  with `gh pr create`. The PR body starts with `Closes #<N>`, then a short
  summary, then a section "Cases" with a table of case id, test file, and
  test name, one row per test, then a section "Deviations" listing anything
  you did differently from the issue and why (write "none" if none).
- End your final message with: the PR number, the branch name, and the
  Deviations section verbatim.
```

Wait for the agent to finish. Do not implement in the main session while
waiting.

### 3. Handle the agent's report

- If the agent stopped on a design question: quote it as-is, put it to the
  developer in the form `architect` step 4 gives (the AskUserQuestion tool),
  and stop. The answer may need an issue update; that is the
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

Run the guard script's verify operation first:

```
node .claude/skills/implementer/scripts/issue-guard.mjs verify <N> --dir <scratchpad>/issue-guard
```

On a non-zero exit, do not invoke `reviewer`. Leave the PR open and report
the script's lines to the developer exactly as printed.

On success, invoke the `reviewer` skill with the PR number. Pass along the
Deviations section and whether CI ran.
