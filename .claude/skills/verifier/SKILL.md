---
name: verifier
description: "Run a pull request's actual behaviour and post a verdict on its head commit. Use after the reviewer skill finishes with a PR, whenever a child issue carries a behaviour constraint. Reads the issue's 実物での確認 section, runs each declared entry point in a disposable worktree, judges it with a fresh agent that neither wrote nor reviewed the code, and posts pass, fail, not-needed, or unverifiable to GitHub with the reason and evidence on the PR."
---

# Verifier

## Why a fresh agent judges

The agent that wrote the code and the agent that reviewed it both already
believe the change works; asking either to also confirm it would just have
them agree with themselves. The judge here is a third agent, spawned only for
this run, that never saw the implementation or the review — it only sees the
issue's pass condition and what the command actually printed.

## Why an unperformed check is not a pass

A command that could not run — a missing declaration, a missing key, a check
that needs a person to look at a screen — tells us nothing about the
software. Reporting it as passing would let a PR merge on the strength of a
check nobody ran. It is reported as unverifiable instead, with the fact that
stopped it as the reason, so the developer can see exactly what still has not
been confirmed.

## Why burdens live next to the entry point, not here

What running an entry point costs — money, a call to a machine outside this
one, a key this checkout may not have, a person's judgement — is a fact only
that entry point knows. This skill and `architect` both read the declaration
next to the entry; neither one keeps its own table of burdens, because a
table kept here would drift from the entry the moment its cost changes.

## Why the checked commit is pinned

A push can land on the PR while this skill is still running. If posting read
the head fresh at that point, the status would describe a commit nobody
checked. The commit is read once, early, and every later step — the
worktree, the judge, and the post to `verdict.mjs` — is pinned to that same
commit, so the status always describes exactly what ran.

## Every path ends the same way

Not-needed, unverifiable, fail, and pass are not separate endings; they are
the four values the same last two steps can post. Whatever stops a run early
— nothing to check, a missing declaration, a missing key, a refused
approval, an agent that could not start — is still a result, and every
result goes through posting the status and writing the PR comment. A path
that stopped short of that would leave the developer without a status to
read, and, once a worktree exists, would leave it behind to block the next
run's `git worktree add`.

## Input

- The PR number.
- The issue snapshot file the `implementer` skill already produced, at
  `<scratchpad>/issue-guard/issue-<N>.json`.
- The path to the developer's main checkout, where an optional `.env` may
  be.

## Output

One of four results, its reason, and the URL of the PR comment written in
step 5.

## Steps

### 1. Read the confirmation section

Read `## 実物での確認` from the snapshot's `body`.

- `- なし` alone: this issue has no entry points to check. Note the result as
  not-needed, with no reason, and go to step 5.
- `- なし: <reason>`: note the result as not-needed, with that reason, and go
  to step 5.
- Anything else: it names the entry points (V items) to check. Continue to
  step 2 with that list.

### 2. Read the head, check it out, and prepare the worktree

Read the commit being checked, once, and keep it for every later step:

```
gh pr view <PR> --json headRefOid
```

```
git worktree add <scratchpad>/verify-<PR> <headRefOid>
```

The worktree is a fresh checkout: it has no installed packages, no built
output, and no `.env`. Prepare it before reading any declaration:

```
pnpm install --frozen-lockfile && pnpm build
```

(run inside `<scratchpad>/verify-<PR>`), then link the checkout's own env
file in place so a declared command runs unchanged from the worktree root —
never copy the key values themselves:

```
ln -s <main checkout>/.env <scratchpad>/verify-<PR>/.env
```

Link it even when the main checkout has no `.env`: a dangling link is read
as no file, the same as no link at all.

If either command fails, note the result as unverifiable, with the failure
as the reason, and go to step 5 — the worktree already exists, so step 6
still removes it.

For each V item, read its declaration:

```
node .claude/scripts/entries.mjs show <entry> --root <scratchpad>/verify-<PR> --env <main checkout>/.env
```

No declaration for the entry, a non-empty `missing` (a key neither this
session's environment nor the checkout's `.env` has), or a burden of `hands`
(a person has to look and judge): note that item as unverifiable, with that
fact as its reason, and do not run it. Keep reading the remaining V items'
declarations regardless — one item's outcome does not stop the others from
being checked.

### 3. Ask before anything that costs money or reaches outside

For each V item that still has a command to run, and whose declared burdens
include `cost` or `outside`, ask with AskUserQuestion right before running
it, not earlier — approval is for this one run, not a standing yes. State
the command and what kind of cost or outside effect it carries. Options: run
it, or do not.

Not approved: note that item as unverifiable, with the reason
"承認されませんでした".

### 4. Spawn the judge

One fresh agent per PR — Agent tool, `subagent_type`: `general-purpose`,
`model`: `sonnet`. Give it the V items that are still to run, each one's
declared command, the worktree path, and the fact that its `.env` link is
already in place and may point at no file. Tell it keys may instead come
from this session's own environment. It runs each command from the worktree
root, captures what it prints, and returns, per V item: the command, an
excerpt of what it observed, and its judgement against that item's pass
condition, with the observed values quoted. It never edits a file — it only
runs the declared commands and reads their output.

If the agent's own run fails to start, or it reports that it could not judge
an item, note that item as unverifiable with the agent's own words as the
reason.

### 5. Decide and post

By now every V item (if there were any) carries either a judgement or a
reason it was not run. Decide the overall result from all of them together:

- Any item failing: the result is fail, with that item's judgement as the
  reason.
- Otherwise, any item unverifiable: the result is unverifiable, with that
  item's reason.
- Otherwise (including the not-needed case from step 1, and every item
  judged passing): the result is pass or not-needed as already noted.

Post the result to the commit read in step 2 (or, for not-needed, the head
read at step 1's time):

```
node .claude/skills/verifier/scripts/verdict.mjs <PR> <result> [--reason <text>] --sha <commit>
```

Then write one PR comment, in Japanese, following `.claude/rules/writing.md`:
the result, and for each V item the command that ran (or why it did not),
what was observed, and the judgement against its pass condition.

```
gh pr comment <PR> --body '...'
```

### 6. Clean up

If step 2 created a worktree, remove it — this also removes the `.env` link:

```
git worktree remove <scratchpad>/verify-<PR>
```

## On failure

- An unknown result, or `fail`/`unverifiable` with no reason, passed to
  `verdict.mjs`: it prints its usage and exits without touching GitHub.
- A command that cannot start, at any step: note the affected item (or, for
  a failure that is not about one item, the whole run) as unverifiable, with
  the error as the reason, and continue through steps 5 and 6.
- `verdict.mjs` failing to write to GitHub: it prints gh's own error and
  exits non-zero; report that to the developer and leave the PR as it is.
