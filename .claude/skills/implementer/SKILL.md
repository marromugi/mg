---
name: implementer
description: "Build one piece of work that the architect skill wrote up — a GitHub issue, or, for work finished in this session, a body file with no issue. Use whenever the developer points at an issue and wants it built — \"#12 をやって\", \"issue 3 を実装して\", \"implement #7\", an issue URL, or \"start on the next issue\". Hands the work to a Sonnet agent in an isolated git worktree that may redraw the design on the spot when it does not hold, gets a PR opened, waits for CI, then hands the PR to reviewer and verifier. Do not use for work nobody has written up yet; send that to architect first."
---

# Implementer

## Why it works this way

The implementation is handed to a separate agent so that the main session
stays the developer's conversation partner. The agent works in its own
worktree so the developer's checkout is untouched and several pieces of work
can be in flight. The agent owns the design while it builds: when the
design in the issue does not hold, it redraws it and says what changed,
rather than stopping (`software-design-theory`, principle 9).

Whether an issue is ready is not decided here. dispatcher reads GitHub for
that, once per pass, and a single named issue starts as it is. This skill
reads the issue once, saves its text, and notes when it was last updated.
The agent builds from that saved text, and dispatcher compares the noted
time with GitHub's before it merges.

## Steps

### 1. Read the work

**From an issue.** Read it once:

```
gh issue view <N> --json body,updatedAt
```

Write `body` to `<scratchpad>/issues/issue-<N>.md` (make the folder first)
and keep `updatedAt`. That file is the copy to use from here on; do not
fetch the issue again.

Check that the body has a `To Implementer` section. If it does not, the
issue was not written up by architect; stop and tell the developer to run
architect for it. Issues in the earlier format are built as they are
(`architect/references/issue-format.md`, last paragraph).

When the Design has a `Parent: #<P>` line, read the parent too, for the
agent prompt only:

```
gh issue view <P> --json body
```

**From a body file.** architect hands over a scratchpad file in the issue
format when the work has no issue. The file is the copy to use.

### 2. Spawn the implementation agent

Use the Agent tool with:

- `subagent_type`: `general-purpose`
- `model`: `sonnet`
- `isolation`: `worktree`

The prompt must contain the full body (and the parent's body if any), plus
these instructions, in this spirit:

```
You are building the work below in this repository.

<body>
<parent body, if any>

Rules:
- Build what Request asks for, in the shape Design describes. Nothing
  listed under "Out of scope" changes.
- Read .claude/skills/software-design-theory/SKILL.md before writing code:
  the principles, Tests, and principle 8 (No history in the code).
- If building shows the design does not hold, redraw it by the principles
  and carry on. Do not stop to ask. Write what changed and why in the PR
  body under "Design changes".
- Names, values, and formats the body leaves open are yours to decide.
  List the ones the developer might want to change under "Decided" in the
  PR body.
- Stop and report instead of acting only when the next step would spend
  money, cannot be undone, or reaches outside this machine, or when what
  to build is unclear in a way that changes the result.
- Write tests only for the behaviour Request asks for, called the way its
  users call it, with literal expected values. A bug fix gets one test that
  reproduces the bug. Do not add tests for anything else.
- Test names and descriptions say what is observed.
- Run the project's test, type check, and lint commands. Do not open a PR
  with failures you know about.
- Commit on a branch named <issue-N or task>-<short-slug>, push it, and
  open a PR with `gh pr create`. The PR body starts with `Closes #<N>` when
  there is an issue; with no issue it starts with the body above, verbatim.
  Then a short summary, then "Decided", then "Design changes" (write "none"
  if none).
- End your final message with: the PR number, the branch name, and the
  Design changes section verbatim.
```

Wait for the agent to finish. Do not implement in the main session while
waiting.

### 3. Handle the agent's report

- If the agent stopped on something the developer must answer: ask it with
  the AskUserQuestion tool, following `.claude/rules/questions.md`, in
  Japanese following `.claude/rules/writing.md`. Send the answer back to
  the same agent with SendMessage and wait again. If the developer declines,
  leave any PR open and report.
- If a PR was opened: note the PR number and the Design changes section.

### 4. Wait for CI

```
gh pr checks <PR> --watch --fail-fast
```

Run it with a generous timeout. `verifier` runs later, in step 6, so this
wait must not treat its status as a CI result. Decide green or red from:

```
gh pr checks <PR> --json name,bucket --jq '[.[] | select(.name != "verifier")]'
```

leaving out any entry named `verifier`. Three outcomes:

- **No checks configured**: continue to review, and say so in the handoff.
- **Green**: continue to review.
- **Red**: send the failing check names and log excerpt back to the same
  agent with SendMessage and ask it to fix and push. Wait again. If it is
  still red after that one retry, stop and show the developer the failure;
  do not loop.

### 5. Hand off to review

Invoke the `reviewer` skill with the PR number, and, when the
implementation agent is still available, its agent id so reviewer can send
fixes to it.

### 6. Verify

Invoke the `verifier` skill with the PR number, the body file to read
`Verification` from (the saved issue file at
`<scratchpad>/issues/issue-<N>.md`, or the body file), and the path to the
developer's main checkout.

- **pass** or **not-needed**: done. Pass the result on to the caller.
- **fail**: send verifier's PR comment to the same implementation agent with
  SendMessage, and ask it to fix and push. Once. Then repeat step 4 (CI),
  step 5 (reviewer), and this step, from the start.
- Still **fail** after that one retry, or **unverifiable**: leave the PR
  open and report the reason.

With an issue, the result to the caller also carries the issue's
`updatedAt` (ISO string) next to the PR number and Design changes.
