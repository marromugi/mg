---
name: reviewer
description: "Review a pull request against what its request asked for. Use after the implementer skill opens a PR, and whenever the developer asks to review a PR — \"PR #14 をレビューして\", \"review the PR\", a PR URL, \"check what the agent built\". Sends the same prompt to two reviewers on different models (Opus and Fable), who report only mismatches with the request, concrete bugs, harm to the developer, and tests that guard nothing. Triages every finding itself — fix, or dismiss with a reason — posts all of them on the PR, gets the fixes pushed, and asks the developer only about harm."
---

# Reviewer

## Why it works this way

Two reviewers on different models get the same prompt. They are not split
by lens: the point is that two differently trained readers look at the
same thing, and a finding both raise is the strongest signal there is.

Reviewers who must find something inflate nits into findings. So the
prompt says what not to report, lets them answer `pass`, and asks for a
concrete scenario behind every finding. The reviewer skill itself is the
lead: it has the context the two readers lack, and it decides each finding
rather than passing them all on. Dismissed findings stay visible on the PR
so the developer can overturn the call.

The rules this skill applies are in `software-design-theory` (Tests, Pull
request review, What goes to the developer). Read them before step 3.

## Steps

### 1. Collect context

```
gh pr view <PR> --json number,title,body,url,headRefName,headRefOid,files
```

Keep `url`, `headRefOid`, `headRefName`, and the file list. Find the
request:

- With `Closes #N` in the body: `gh issue view <N> --json title,body`, and
  the parent's body too when the issue has a `Parent: #<n>` line.
- Without: the PR body starts with the body architect wrote.

From these, take `Request` (or, for an issue in the earlier format,
`Background`, `Changes`, and `Cases`), and `Verification`. From the PR
body, take `Decided` and `Design changes`.

### 2. Spawn the two reviewers

Two Agent calls in one message:

- `subagent_type`: `general-purpose`, `model`: `opus`
- `subagent_type`: `general-purpose`, `model`: `fable`

If the Fable seat is rejected, run it on `opus` and say so in the report.

Both get the same prompt, with the slots filled:

```
You are reviewing a pull request in this repository. You did not write it.

What the developer asked for: <Request>
PR: <url>
Design changes the author made while building: <Design changes, or "none">
How it is run: <Verification items>

Read the diff with `gh pr diff <number>`, and the code around it as far as
you need. Read .claude/skills/software-design-theory/SKILL.md, sections
Tests and Pull request review.

Report only these four kinds:
- mismatch: it does not do what was asked. Name the input and what the
  developer would see instead.
- bug: a concrete input or state that gives a wrong result or a crash.
  Trace the call site; a value no caller can pass is not a bug.
- harm: something that costs the developer money, cannot be undone, or
  reaches outside this machine without being asked for.
- test: a test in this PR that guards nothing, by the list in "Tests that
  guard nothing".

Do not report:
- another way you would have built it
- naming, formatting, or style
- abstractions the code does not need yet
- anything you cannot tie to a concrete scenario

Do not edit files. Do not run anything that calls a paid API.

Return findings in this form, or the single line "pass":

- kind: mismatch | bug | harm | test
  where: <path:line>
  scenario: <input or state -> what happens>
  evidence: <quoted code or command output>
```

### 3. Triage

Put both lists together. A finding both raised is one finding naming both.
Decide each:

- **fix** — the scenario can happen, or the test does guard nothing. Both
  reviewers raising it is reason to fix unless the code proves otherwise.
- **dismiss** — the scenario cannot happen (trace the caller), or the
  finding is a preference in disguise. Write the reason in one line.
- **ask** — kind `harm` that holds. It goes to the developer in step 6.

A finding that points at a choice listed under `Decided` or `Design
changes` is not reopened here; dismiss it with that pointer. The developer
can overturn those choices from the report.

### 4. Post every finding on the PR

Post each finding before anything is fixed, so each comment anchors to the
commit that was reviewed. The body starts with the kind and the decision,
such as `[bug / fix]` or `[test / dismiss]`, then the scenario, then which
reviewer raised it, then the reason for a dismissal. Write in Japanese
following `.claude/rules/writing.md`.

For a finding that points at a line:

```
gh api repos/<owner>/<repo>/pulls/<PR>/comments \
  -f commit_id=<headRefOid> -f path=<file> -F line=<line> -f side=RIGHT \
  -f body='[bug / fix] ...'
```

For a finding with no single line:

```
gh pr comment <PR> --body '[mismatch / fix] ...'
```

### 5. Get the fixes pushed

Send every `fix` finding to the implementation agent with SendMessage when
the caller passed its id. Otherwise spawn a new agent (`model`: `sonnet`,
`isolation`: `worktree`) told to check out `headRefName` first. A `test`
finding is fixed by deleting the test. Ask it to run the tests and push.
Wait for CI once more as in the implementer skill. One fix round; do not
review again on your own.

After the push, reply on each fixed thread with the commit that fixed it:

```
gh api repos/<owner>/<repo>/pulls/<PR>/comments --jq '.[] | {id, path, line, body}'
gh api repos/<owner>/<repo>/pulls/<PR>/comments/<id>/replies -f body='<sha> で修正しました。'
```

### 6. Ask about harm

Skip this step when nothing is `ask`.

Put each one to the developer with the AskUserQuestion tool, reading on
its own following `.claude/rules/questions.md`: what the change would do to
them, and the options. Apply the answer the same way as step 5.

### 7. Report

Japanese, following `.claude/rules/writing.md`:

1. One line: the PR, what it builds, whether CI passed, and that the
   findings are on the PR.
2. Findings fixed, briefly, with which reviewer raised each and whether
   both did.
3. Findings dismissed, one line each with the reason, so the developer can
   overturn them.
4. Anything left open: a harm the developer declined, a fix that did not
   land, a seat that ran on a fallback model.

Then stop. Merging is dispatcher's call, or the developer's.
