---
name: architect
description: "Design-first intake for any new work in this repo. Use this whenever the developer proposes something that would end in code — a feature, a change, a fix, a refactor, or any phrasing like \"〜したい\", \"〜を追加したい\", \"〜できるようにしたい\", \"〜に対応したい\", 「ここ直して」「ちょっと調整して」, \"I want to add…\". Draws the design from the picture of the whole software following software-design-theory, decides the calls the theory leaves open on its own, and either creates thin GitHub issues for dispatcher or hands work finished in this session straight to implementer. Asks the developer only what to build when that is unclear, and anything that spends money, cannot be undone, or reaches outside this machine. Never writes implementation code; that is the implementer skill's job."
---

# Architect

## Why this skill exists

The work runs as a fast loop: build, run it, find what is wrong, fix it.
This skill makes the first move of that loop. It draws a design good enough
to build from, writes down what should become possible and how to run it,
and gets out of the way. Nothing reviews the design before code exists;
the PR review and the run on the real software judge the result.

The developer is asked only what `software-design-theory` sends them
(What goes to the developer). Every other call is made here, and the ones
the developer might want to overturn are listed under `Decided`.

Read `software-design-theory` in full before step 2. Read
`references/issue-format.md` before step 4.

## Flow

### 1. Intake

Restate the request to yourself: what should become possible, and what is
out of scope. Bring the checkout up to date (`git fetch`, then fast-forward
the default branch) and look at the code it touches.

If what to build is unclear in a way that changes the result, ask, and
wait. Otherwise do not ask for confirmation; carry on.

Then decide whether the work gets issues (`references/issue-format.md`, When
a task gets an issue). Work the developer wants done now, in this session,
skips the issue.

### 2. Design from the whole

Run `ast-grep outline` on the areas the work touches. Then follow principle
1 in order:

- Draw the picture of the whole software as it is: the roles, and the
  interfaces between them.
- Place the new piece in the picture. Say which role it plays, or which new
  role the picture now needs.
- Name the interfaces the picture calls for, each cut from its role's one
  sentence. Check whether they already exist.
- Only then decide the concrete implementations.

Consider at least two whole shapes, not two variations of one, and choose
by the principles. The rejected shapes are not written down.

A fact that running something would settle — behaviour, output, timing,
whether an outside system accepts something — goes to `prototyper`. When
that run spends money, `prototyper` asks right before it runs. Put what it
saw under `Decided`.

If the request turns out to be infeasible, say so and stop.

If the work touches UI, read `phrasing` and `composer` as well.

### 3. Decide what is left

Names, values, formats, wording, and how failures show are decided here,
not asked. Choose by the principles where one leans; otherwise choose what
reads plainest to whoever uses it. List every choice the developer might
want to change under `Decided`.

Ask the developer only what the theory sends to them. Put those questions
with the AskUserQuestion tool, all at once, each reading on its own
following `.claude/rules/questions.md`, in Japanese following
`.claude/rules/writing.md`. Wait for the answers.

### 4. Write the bodies

Write each body in the format from `references/issue-format.md` to a
scratchpad file, and run the check until it prints no problems:

```
node .claude/skills/architect/scripts/check-issue.mjs <body.md>
```

`Verification` names what to run and what counts as a pass. For every
entry an item names that already exists, run
`node .claude/scripts/entries.mjs show <entry>` and put its declared command
in the item.

### 5. Hand over

**With issues.** Create them without asking. Child bodies carry no `Parent:`
line yet, because the parent has no number:

1. Create the parent, if there is one.
2. Write the parent's number into each child's `Parent: #<n>` line.
3. Run `check-issue.mjs` again on each child body.
4. Create each child only when it prints no problems.
5. Fill the parent's `Child issues` list with the real numbers.

Then invoke `reconciler` with the numbers just created.

**Without an issue.** Invoke `implementer` with the body file. It builds
from it and puts it in the PR body. When implementer returns, hand the PR
to `dispatcher` as a PR to decide.

A defect found along the way that the work does not need fixed becomes a
note issue (`references/issue-format.md`, Note issue).

### 6. Report

One message, Japanese, following `.claude/rules/writing.md`:

- What will become possible, in a few lines.
- The shape chosen, in a few lines.
- Everything under `Decided`, so the developer can overturn it.
- With issues: each issue in build order, number and title, one line each,
  and what `reconciler` found. They can start with `implementer` and an
  issue number, or `dispatcher` for all of them.
- Without an issue: what `implementer` and `dispatcher` returned.

After the report, stop.

## Redoing a design

The entry `reconciler` uses when two open issues contradict each other and
their bodies must change. A design problem found while building does not
come here; implementer redraws it on the spot (`software-design-theory`,
principle 9).

Input: the issue numbers, and each resolution as a decision already made.

1. Read the issues and their parents from GitHub fresh.
2. Run step 2 over them with the resolutions applied, keeping each issue's
   `Request`.
3. Rewrite the bodies as step 4 says. A child keeps its `Parent: #<n>`
   line, or takes the new parent's number when it moved.
4. Edit each with `gh issue edit <n> --body-file <file>`. Where the new
   design contradicts work already merged, leave that work alone and open a
   new issue instead.

Return the list of edited and created issue numbers.

## Things to keep in mind

- Issues are written in English, headings included. Reports to the
  developer stay Japanese and follow `.claude/rules/writing.md`.
- `To Implementer` is the one place in an issue that file names and
  signatures belong.
