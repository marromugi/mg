---
name: architect
description: "Design-first intake for any new work in this repo. Use this whenever the developer proposes something that would end in code — a feature, a change, a fix, a refactor, or any phrasing like \"〜したい\", \"〜を追加したい\", \"〜できるようにしたい\", \"〜に対応したい\", 「ここ直して」「ちょっと調整して」, \"I want to add…\". Draws the design from the picture of the whole software following software-design-theory, decides the calls the theory leaves open on its own, and either frames a goal issue for lead or hands work finished in this session straight to implementer. Asks the developer only what to build when that is unclear, and anything that spends money, cannot be undone, or reaches outside this machine. Also takes stock of note issues and observations in bulk — 「メモの issue を棚卸しして」「メモを片づけて」「溜まった気づきを整理して」「このフィードバックたちを処理して」 — closing what the code no longer has and framing the rest. Never writes implementation code; that is the implementer skill's job."
---

# Architect

## Why this skill exists

The work runs as a fast loop: build, run it, find what is wrong, fix it.
This skill makes the first move of that loop. It writes down what should
become possible and how to tell it is done, and gets out of the way. When
every fact is in hand and the work is one step, it also draws the design.
Otherwise the steps are lead's, decided round by round from what turns out
to be true. Nothing reviews the design before code exists; the PR review
and the run on the real software judge the result.

The developer is asked only what `software-design-theory` sends them
(What goes to the developer). Every other call is made here, and the ones
the developer might want to overturn are listed under `Decided`.

Read `software-design-theory` in full before step 2. Read
`references/issue-format.md` before step 4. For several notes at once,
follow `references/notes.md`, which runs this flow for each.

## Flow

### 1. Intake

Restate the request to yourself: what should become possible, and what is
out of scope. Bring the checkout up to date (`git fetch`, then fast-forward
the default branch) and look at the code it touches.

If what to build is unclear in a way that changes the result, ask, and
wait. Otherwise do not ask for confirmation; carry on.

Then pick the form (`references/issue-format.md`, Which form). A goal
issue is the default. A single issue or a body file only when every fact
the design rests on is already in hand and the work is one step.

**For a goal issue**, skip steps 2 and 3. Copy the developer's words into
`Asked` as they said them. Read just enough of the code to write `Known` with its evidence, the `Open questions` that decide how the
goal is reached, and the `Bounds`. Do not design the steps. Then go to
step 4.

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
whether an outside system accepts something — is settled by a throwaway,
following `lead/references/run.md`, which asks right before a run that
spends money. Put what it saw under `Decided`.

If the request turns out to be infeasible, say so and stop.

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

Write each body, goal or single, in the format from `references/issue-format.md` to a
scratchpad file, and run the check until it prints no problems:

```
node .claude/skills/architect/scripts/check-issue.mjs <body.md>
```

`Verification` names what to run and what counts as a pass. For every
entry an item names that already exists, run
`node .claude/scripts/entries.mjs show <entry>` and put its declared command
in the item.

### 5. Hand over

**A goal issue.** Create it without asking:

```
gh issue create --title "<title>" --body-file <body.md>
```

Then invoke `lead` with its number.

**A single issue.** Create it the same way, then invoke `lead`.

**Without an issue.** Invoke `implementer` with the body file. It builds
from it and puts it in the PR body. When implementer returns, merge the PR
or leave it open by `lead/references/merge.md`, skipping the issue check
since there is no issue.

A defect found along the way that the work does not need fixed becomes a
note issue (`references/issue-format.md`, Note issue).

### 6. Report

One message, Japanese, following `.claude/rules/writing.md`:

- What will become possible, in a few lines.
- For a single issue or body file: the shape chosen, in a few lines, and
  everything under `Decided`, so the developer can overturn it.
- For a goal: its `Open questions` and `Bounds`.
- With an issue: its number and title, and what `lead` returned.
- Without an issue: what `implementer` returned, and whether the PR was
  merged.

After the report, stop.

## Things to keep in mind

- Issues are written in English, headings included. Reports to the
  developer stay Japanese and follow `.claude/rules/writing.md`.
- `To Implementer` is the one place in an issue that file names and
  signatures belong.
