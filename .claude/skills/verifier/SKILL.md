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

## Input

- The PR number.
- The issue snapshot file the `implementer` skill already produced, at
  `<scratchpad>/issue-guard/issue-<N>.json`.
- The path to the developer's main checkout, for its `.env`.

## Output

One of four results, its reason, and the URL of the PR comment written in
step 5.

## Steps

### 1. Read the confirmation section

Read `## 実物での確認` from the snapshot's `body`.

- `- なし` alone: the result is not-needed, with no reason. Post it with
  `verdict.mjs` (step 5's posting call) and stop; there is nothing to run.
- `- なし: <reason>`: the result is not-needed, with that reason as the
  reason. Post and stop the same way.
- Anything else: continue to step 2 with the list of entry points (V items)
  it names.

### 2. Check out the head and read each entry's declaration

```
git worktree add <scratchpad>/verify-<PR> <headRefOid>
```

`headRefOid` comes from the snapshot; if it is stale, re-read it with
`gh pr view <PR> --json headRefOid` first.

For each V item, read its declaration:

```
node .claude/scripts/entries.mjs show <entry> --root <scratchpad>/verify-<PR> --env <main checkout>/.env
```

- No declaration for the entry, a non-empty `missing` (a key the checkout's
  `.env` does not have), or a burden of `hands` (a person has to look and
  judge): the result is unverifiable. The reason is that fact — which entry,
  and which of the three. Stop; nothing in this PR runs.

### 3. Ask before anything that costs money or reaches outside

For each V item whose declared burdens include `cost` or `outside`, ask with
AskUserQuestion right before running it, not earlier — approval is for this
one run, not a standing yes. State the command and what kind of cost or
outside effect it carries. Options: run it, or do not.

Not approved: the result is unverifiable, with the reason "承認されませんでした".

### 4. Spawn the judge

One fresh agent per PR — Agent tool, `subagent_type`: `general-purpose`,
`model`: `sonnet`. Give it the V items, each one's declared command, the
worktree path, and the `.env` path. It runs each command with that
environment, captures what it prints, and returns, per V item: the command,
an excerpt of what it observed, and its judgement against that item's pass
condition, with the observed values quoted. It never edits a file — it only
runs the declared commands and reads their output.

If the agent's own run fails to start, or it reports that it could not judge
an item, treat that item as unverifiable with the agent's own words as the
reason.

### 5. Decide and post

Any V item judged failing: the result is fail, with that item's judgement as
the reason. All judged passing: the result is pass.

Post the result to the PR head commit:

```
node .claude/skills/verifier/scripts/verdict.mjs <PR> <result> [--reason <text>]
```

Then write one PR comment, in Japanese, following `.claude/rules/writing.md`:
the result, and for each V item the command that ran, what was observed, and
the judgement against its pass condition.

```
gh pr comment <PR> --body '...'
```

### 6. Clean up

```
git worktree remove <scratchpad>/verify-<PR>
```

## On failure

- An unknown result, or `fail`/`unverifiable` with no reason, passed to
  `verdict.mjs`: it prints its usage and exits without touching GitHub.
- A command that cannot start, at any step: the result is unverifiable, with
  the error as the reason.
- `verdict.mjs` failing to write to GitHub: it prints gh's own error and
  exits non-zero; report that to the developer and leave the PR as it is.
