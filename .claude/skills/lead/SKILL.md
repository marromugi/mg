---
name: lead
description: "Drive one goal to done in rounds, deciding each next move from the facts in hand: ask small questions in parallel (how the code works now, what a change could break, what an outside system actually does), read the answers, then build one step, ask the developer, or stop. Builds each step through implementer and decides its merge. Each round is written on the goal issue, so any session can pick it up. Use when architect hands over an issue, and whenever the developer points at an issue to build or continue — 「#120 を進めて」「#12 をやって」「続きをやって」「implement #7」, an issue URL. Never writes implementation code. For work with no issue yet use architect."
---

# Lead

## Why it works this way

A plan drawn before the facts are in goes stale as soon as building turns
one of them over, and every step written from it carries the stale fact
forward. So the only things fixed up front are what should become possible
and how to tell it is done: the goal issue's `Asked` and `Verification`.
Everything between is decided one round at a time, from what is true now.

Finding facts is the slow part, and most of it is independent: reading how
the code works, checking what a change could break, running a throwaway to
see what an outside system does. Those go out as small questions to
separate agents at once. Building does not parallelise the same way, since
steps change the code the next step reads, so one step is in flight at a
time unless the file sets are certainly disjoint.

The goal issue holds the record: its body frames the goal, and one comment
per round says what was asked, what was seen, and what was decided. The
record is what lets a new session, or the developer, pick the work up
without this conversation.

Lead owns the loop, so it also makes the one call the other skills leave
open: merge a step, or leave it open. reviewer stays a reviewer and
verifier stays a verifier. Several goals are several leads, one per
session; nothing here works through a queue.

Read `software-design-theory` in full before the first decision in a
session. Its principles shape each step; its "What goes to the developer"
is the whole list of what is asked.

## Input

An issue number. The body says what kind of goal it is
(`architect/references/issue-format.md`):

- **A goal issue** has `## Asked` and `## Open questions`. Start at
  round 1.
- **An issue with `## To Implementer`** is a goal whose first step is
  already written. Round 1 reads the code it names; when nothing has
  turned its facts over, build it as the step, from a copy of the body.
  Its `Verification` is the goal's.
- **A parent with `## Child issues`** is a goal whose steps were written
  ahead. Take each open child in order as the next step, rereading it
  against the facts first; a child whose facts no longer hold is redrawn
  as a step body, and the child is closed with a comment naming the PR
  that replaced it.

Anything else, such as a note issue, goes to architect first.

Before the first round, check the main checkout and stop if any fails:

```
git status --short        # must print nothing outside .claude/worktrees
git branch --show-current # must be main
git pull --ff-only origin main
```

Every step's worktree branches from this checkout, and every merge is
pulled into it. Do not stash or reset the developer's edits; say which
check failed and stop.

## A round

### 1. Read the record

Bring the main checkout up to date (`git fetch`, then fast-forward main),
then read the goal fresh, every round:

```
gh issue view <N> --json title,body,comments,state
```

The facts in hand are `Known`, every earlier round's `Seen`, and what the
merged steps changed. Read the code the next move touches yourself when
one or two files answer it; spawn only for what is wider than that.

### 2. Pick the questions

List what is unknown and would change the next move. Order them riskiest
first: the unknown that could invalidate the most work. Drop any whose
answer would not change what happens next.

Each question is one of three kinds:

| Kind | Asks | Goes to |
|---|---|---|
| read | how the code works now, where a thing lives, who calls it | an `Explore` agent |
| risk | what a change could break past the obvious place: callers, shared files, entries, outside systems | an `Explore` agent |
| run | a fact only running settles: behaviour, output, timing, whether an outside system accepts something | a throwaway, `references/run.md` |

A fact about an outside system is settled by running it before any step
builds on it.

### 3. Ask them at once

Spawn every question of the round in one message, in the background.
`read` and `risk`: Agent tool, `subagent_type`: `Explore`, `model`:
`sonnet`. `run`: follow `references/run.md`, which asks the developer right
before anything that costs money or reaches outside this machine.

Each brief reads on its own: the question, the paths or area to look in,
what would count as an answer, and this return form:

```
answer: <one or two lines, or "not settled">
seen:
- <fact> — <evidence: file:line, a command and its output, a URL>
not settled:
- <what is still unknown, and why>
```

A result whose facts carry no evidence goes back once with the same brief.
A second miss is recorded as not settled. A not-settled answer is never
read as a yes.

### 4. Decide the next move

From the facts, by the principles, pick one:

- **Ask more.** A new round, with the questions the answers raised.
- **Build a step.** See below.
- **Ask the developer.** Only what "What goes to the developer" lists. Use
  AskUserQuestion following `.claude/rules/questions.md`, in Japanese
  following `.claude/rules/writing.md`, and wait.
- **Done.** See "Finishing".
- **Stop.** See "Stop conditions".

Check the move against `Asked`, `Verification`, and `Bounds`, not against
`Request`, by `software-design-theory` (How far the maker goes alone). A
guess the move rests on goes in this round's comment under `Decided`.

A comment from the developer on the goal is a correction. Name which of
the three was missing, and put their call under `Bounds` with
`gh issue edit` before the next move (`software-design-theory`, When the
developer corrects).

A fact that contradicts `Known` or an earlier round outranks it. Say so in
this round's comment and decide from the new fact.

### 5. Write the round

Add one comment to the goal issue, in English:

```
### Round <n>

Questions:
- <question> (<read | risk | run>)

Seen:
- <fact> (<evidence>)

Decided:
- <the next move, and the fact or principle it rests on>
```

A round that built a step adds the PR number, its `Design changes`, and the
verifier result under `Seen` in the next round. Raw agent output stays out
of the comment; it carries the facts and their pointers.

Right after posting, and after any edit lead makes to the body, keep the
issue's `updatedAt`. A change after it is the
developer's, and it holds the next merge (`references/merge.md`).

Then start the next round.

## Building a step

A step is the smallest change that moves toward `Verification` and can be
run on its own. Design it from the whole (`software-design-theory`,
principle 1) with the facts now in hand, inside `Bounds`.

1. Write its body to a scratchpad file in the single-issue form
   (`architect/references/issue-format.md`). The first line of `Design` is
   `Goal: #<N>`, alone. `Verification` names what this step makes runnable.
   The step that should complete the goal also carries every item of the
   goal's `Verification`.
2. Check it until it prints no problems:

   ```
   node .claude/skills/architect/scripts/check-issue.mjs <body.md>
   ```

3. Invoke `implementer` with the body file. It runs reviewer and verifier,
   and hands back the PR number, `Decided`, `Design changes`, reviewer's
   report, CI, and the verifier result.
4. Merge it or leave it open, following `references/merge.md`.

A step left open ends the round. The next round reads why from the PR and
decides from there: a smaller step, a different one, or a question.

Two steps run at once only when it is certain they cannot touch each
other: no common file, neither adds to the same index, barrel, README
table, snapshot set, or config file, and neither changes what every package
feels (CI, hooks, root `package.json`, lockfile, lint or type config,
workspace layout, the skill files). If deciding takes an argument, they go
one after another, and each merge lands before the next review starts.

## Finishing

The goal is done when every item of its `Verification` passes on main.

When the last step's PR merged with a verifier pass that covered the goal's
items, that is the evidence. Otherwise spawn a fresh agent, one that built
nothing for this goal, to run each item on the current main as written and
report pass or fail with the output.

When every item passes, close the goal with a last round comment that lists
each item, its result, and the PRs that made it pass:

```
gh issue close <N> --comment "<the last round>"
```

`Verification` is never loosened to reach done. An item that cannot run as
written is rewritten to test the same behaviour, and the rewrite is named
in the round comment. `Asked` never changes; `Request` changes only when
the developer says so.

## Stop conditions

Stop, write the round, and report when:

- Two rounds in a row add no fact that changes the next move.
- The developer declines a question, or a run that the next move needs.
- A step is left open and no smaller or different step is in sight.
- A merge or `git pull --ff-only` fails, or the main checkout is not clean
  on main.

A defect found along the way that the goal does not need fixed becomes a
note issue (`architect/references/issue-format.md`, Note issue).

## Report

One message, Japanese, following `.claude/rules/writing.md`:

- Whether the goal is done, and if not, why it stopped.
- What was found: the facts that decided the moves, one line each.
- What was built: each PR, merged or open, one line each.
- Choices the developer may overturn: each step's `Decided` and
  `Design changes`, with the PR number.
- What the next round would do, when the goal is still open.

Then stop.
