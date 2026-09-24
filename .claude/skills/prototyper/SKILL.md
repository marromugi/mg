---
name: prototyper
description: "Answer a factual design question by building a throwaway and observing what it does, then report exactly what was seen. Use it when `architect` needs a fact — behaviour, output, timing, or whether an outside system accepts something — that only running code can settle, before that question would otherwise go to the developer. Runs in its own disposable git worktree, never the main checkout, and returns observations only; it never recommends an option or chooses a shape. Not for reviewing a design (`software-design-review`), building the real implementation (`implementer`), or confirming a PR's behaviour (`verifier`)."
---

# Prototyper

## Why this skill exists

Some of the questions a design raises have only one honest answer once
something has actually run: what a function returns, how long a call takes,
whether an outside API accepts a given shape. Sending that kind of question
to the developer asks them to guess at a fact instead of stating a
preference. Prototyper exists so `architect` can get the fact by running
something small, and only ask the developer what the theory truly leaves
open.

## Why it observes and does not choose

Architect holds the principles; prototyper does not. Handing it a question
and letting it also pick the answer would move a design decision into a
throwaway script that nobody reviews and that gets deleted right after. So
prototyper reports what it saw, and stops there — it does not recommend an
option, and it does not choose the shape, because that judgement has to be
made against the principles, by the skill that holds them.

## Why nothing it builds is kept

The throwaway exists to answer one question, and the code that answers it is
not the code the design will ship — it skips everything the real
implementation would need for correctness, review, or reuse. Keeping it
around would leave a second, unreviewed implementation sitting next to the
real one. Once the observation is made, the design keeps the fact and the
question that produced it, in the decision record's `確かめたこと`; the
throwaway itself is discarded with the worktree that held it.

## Why it runs in its own worktree

Running against the main checkout would leave stray files or half-finished
changes in the tree everyone else is working from. A disposable worktree
gives the throwaway a place to exist and run without touching anything the
developer, `implementer`, or `dispatcher` rely on being clean.

## Input

- The question to answer.
- What to observe: the value, output, timing, or acceptance that would
  answer it.
- Pointers to the code involved.

## Output

- `observed`: what was seen — output, values, or timings, quoted as they
  came back.
- `ran`: the commands that were run.
- `could not run`: the reason, if the throwaway never ran.

No recommendation: prototyper never says which option is better or which
shape to pick. That judgement is architect's alone.

## Steps

### 1. Plan the throwaway

Plan the smallest throwaway that makes the observation — no more code than
the question needs an answer to.

### 2. List what it calls

For a declared entry point, read its declaration instead of guessing at its
cost:

```
node .claude/scripts/entries.mjs show <entry> --env <main checkout>/.env
```

For anything else the throwaway would call, name the paid services and the
outside machines it reaches.

### 3. Ask before cost or an outside effect

If what step 2 found carries a cost or reaches outside this machine, ask
with AskUserQuestion right before running it — approval is for this one run,
not a standing yes. State what would run, its burdens in plain words, and
two options: run it, or do not.

Not approved: return `could not run: 承認されませんでした`, and do not run
anything.

### 4. Spawn the agent

Spawn one agent to build and run the throwaway — Agent tool, `subagent_type`:
`general-purpose`, `model`: `sonnet`, `isolation`: `worktree`. It builds the
throwaway, runs it, and returns the raw observations. It commits nothing and
pushes nothing.

### 5. Return the observations and remove the worktree

The agent's own cleanup only fires when its worktree is left unchanged, and
the throwaway always leaves files behind, so remove it explicitly. The
agent's result names its worktree path and its branch:

```
git worktree remove --force <path>
git branch -D <branch>
```

The branch holds no commits — the agent never committed to it — so deleting
it loses nothing.

Return `observed`, `ran`, and `could not run` (if any) verbatim, exactly as
the agent reported them. Do not summarize them into a conclusion or a
preferred option — that is for the skill that asked the question.

## On failure

A run that fails to start — the agent cannot start, or the throwaway errors
before it produces an observation — returns `could not run` with the error,
in place of `observed`.
