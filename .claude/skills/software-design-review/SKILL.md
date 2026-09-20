---
name: software-design-review
description: "Judge a software design, or the test cases written for it, against software-design-theory before any code exists. Spawns one Opus reviewer per lens group, each reading the artifact on its own, and returns their findings sorted into what the maker must fix and what only the developer can answer. The architect skill calls this twice — once on the design, once on the cases — and it can be called directly: \"この設計をレビューして\", \"設計論に沿っているか見て\", \"このケースで足りているか見て\", \"review this design\". Not for pull requests; the reviewer skill does those. Not for visual or UX design; phrasing does that."
---

# Software design review

## Why this skill exists

The developer's design intent is written down in `software-design-theory`, so
a design no longer needs the developer as its judge. It does still need a
judge who is not its maker. A maker reviewing its own design finds it
reasonable, because every choice in it already made sense once.

So this skill does one thing: it puts the artifact in front of reviewers who
did not make it, each holding a few lenses, and brings back what they found.
It does not repair the artifact, and it does not decide whether a finding
matters. The caller does the first; the developer does the second.

## Input

- **Stage.** `design` or `cases`.
- **Artifact.** A file path. For `design`, the decision record
  (`architect/references/issue-format.md`, Decision record). For `cases`, the
  full issue bodies, one file each.
- **Request.** The developer's goal and scope, as confirmed at intake.
- **Pointers.** The packages and files the design touches.

When called directly by the developer rather than by architect, gather these
first: write the design under discussion to a scratchpad file in the record
format, and state the request in two or three lines.

## Steps

### 1. Pick the reviewers

Read `software-design-theory`, section Review lenses. The table for the stage
names the reviewers and the lenses each one holds. Use those rows as they are;
do not merge reviewers to save agents, and do not add a lens of your own.

### 2. Spawn them, all at once

One Agent call per reviewer, all in a single message:

- `subagent_type`: `general-purpose`
- `model`: `opus`

Fill `references/reviewer-prompt.md` for each. Every reviewer gets the same
artifact, request, and pointers; only the name and the lenses differ. Pass
file paths, not pasted content, so each reviewer reads the source itself.

### 3. Collect

Wait for all of them. Put the findings in one list, grouped by kind, `ask`
first. Keep each reviewer's wording.

- Two reviewers reporting the same thing stay as one finding that names both.
- Drop nothing. A finding that looks wrong to you is still returned; you are
  the maker or are acting for the maker, and the maker does not dismiss
  findings.
- A reviewer that returned no findings is listed as `pass`.

### 4. Return

Return the list to the caller in the finding format below, then a one-line
tally per reviewer. When the developer called the skill directly, report in
Japanese following `.claude/rules/writing.md`: the `ask` findings as questions
with options, then the `fix` findings.

## Findings

```
- reviewer: <name from the lens table>
  kind: fix | ask
  principle: <number in software-design-theory, or "none">
  where: <section or id in the artifact>
  finding: <what is wrong, in one or two sentences>
  evidence: <a quoted line of the artifact, or a file path and line in the repo>
```

- `fix` — the theory settles it. The finding cites the principle, and the
  maker corrects the artifact.
- `ask` — the theory does not settle it. The finding states the question and
  the options. Only the developer answers.
- A finding with `principle: none` is always `ask`. Without a principle behind
  it, a finding is a preference, and preferences are the developer's.

## When the maker disagrees

The caller may think a finding is mistaken: a `fix` that is wrong, or an
`ask` that a principle does settle. It does not get to drop either on its own.
It sends its argument to the reviewer that raised it, once, with SendMessage.
For an `ask`, the argument is the decision it would make and the principle
that makes it.

- If the reviewer withdraws, a `fix` is gone, and an `ask` is decided by the
  caller as it argued. The developer is not asked.
- If the reviewer stands, it has a reason that survived the argument. The
  finding goes to the developer as an `ask`, with both arguments.

## Rounds

After the maker has revised the artifact, the caller runs this skill again on
the new version. Only reviewers that had findings are spawned again, each told
what it found last time. Two rounds at most; whatever is still open after the
second becomes `ask`.

What the maker changes in answer to the second round is seen by no reviewer.
The caller lists those changes for the developer, apart from the questions, so
that someone other than the maker has looked at them.
