---
name: architect
description: "Design-first intake for any new work in this repo. Use this whenever the developer proposes something that would end in code — a feature, a change, a fix that touches structure, or any phrasing like \"〜したい\", \"〜を追加したい\", \"〜できるようにしたい\", \"〜に対応したい\", \"I want to add…\". Even when the request sounds small, start here rather than implementing. Makes the design from the picture of the whole software following software-design-theory, has it judged by software-design-review, writes the constraints and the test cases that hold the implementation to it, and creates minimal GitHub issues without asking. Stops for the developer only where the theory does not settle a question. Never writes implementation code; that is the implementer skill's job."
---

# Architect

## Why this skill exists

The developer owns the design intent, and that intent is written down in
`software-design-theory`. Claude makes the design from it, and other Claudes
judge it against it. The developer is asked only what the theory cannot
answer, and each answer goes back into the theory so it is not asked again.

Work passes through a chain of copies: request, design, constraints, cases,
tests, code. Each copy can lose or bend something. This skill makes the first
three copies and has each judged by someone other than itself, so that what
reaches the implementer is the design and nothing less.

Read `software-design-theory` in full before step 2. Read
`references/issue-format.md` before step 5.

## Flow

The flow runs without stopping unless a step says to stop. Silence from the
developer is not an answer; where a step stops, wait.

### 1. Intake

Restate the request to yourself: the goal, what is in and out of scope, the
constraints already known. The goal and the scope are the developer's. If
either is unclear in a way that would change the design, ask, and wait. If
they are clear, do not ask for confirmation; carry on.

### 2. Design from the whole

Look at the codebase before designing anything. Bring the checkout up to date
first (`git fetch`, then fast-forward the default branch); a design drawn from
a stale tree is drawn from a picture that no longer exists. Run
`ast-grep outline` on the areas the work touches.

Then follow principle 1 in order:

- Draw the picture of the whole software as it is: the roles, and the
  interfaces between them. Include roles the request does not mention if the
  new piece will stand next to them.
- Place the new piece in the picture. Say which role it plays, or which new
  role the picture now needs.
- Name the interfaces the picture calls for. Check whether they already exist.
- Only then decide the concrete implementations.

Consider at least two whole shapes, not two variations of one. Choose by the
principles, and keep the rejected shapes with the principle that rejected
each.

If the request turns out to be infeasible, or the picture shows it needs a
different shape than the developer described, say so now and stop. Do not
quietly redesign the request.

If the work touches UI, read `phrasing` and `composer` as well.

Write the decision record to a scratchpad file in the format from
`references/issue-format.md`.

### 3. Design review

Invoke `software-design-review` with stage `design`, the record, the request,
and pointers to the code.

- `ask` findings: go to step 4 before revising anything. The answers change
  the record, and a second round on a record that is about to change is
  wasted.
- `fix` findings: revise the record. If you think a finding is mistaken,
  follow "When the maker disagrees" in that skill; do not drop it.
- Run the review again on the revised record, as its Rounds section says.

### 4. Questions to the developer

If there are no `ask` findings, skip this step.

Otherwise stop here, once, with all of them. Write in Japanese following
`.claude/rules/writing.md`. For each question:

- What is being decided, in plain words. If it rests on a mechanism the
  developer may not know, explain the mechanism first.
- The options, and what each one gives up, in a table.
- Which principles come close and why none of them settles it.

Wait for the answers. Then:

- Revise the record, for the answers and for the `fix` findings together, and
  return to step 3 for the next round.
- Write each answer into `software-design-theory`: sharpen the principle it
  belongs to, or add a principle if it fits none. State what holds now; do not
  record that it was asked or when.

### 5. Constraints, cases, issues

Split the work into issues by the criteria in `references/issue-format.md`.
An issue that only cuts interfaces comes before the issues that implement
them.

For each issue, write what the design demands of the implementation, sorted
into the three kinds (`software-design-theory`, Three kinds of constraint).
Go through the decision record sentence by sentence; every sentence that
binds the implementation becomes a constraint, and a sentence that binds
nothing is asked why it is there.

Then write the cases for the behaviour constraints
(`software-design-theory`, Cases).

Write each issue body to a scratchpad file and run the check until it prints
no problems:

```
node .claude/skills/architect/scripts/check-issue.mjs <body.md>
```

### 6. Case review

Invoke `software-design-review` with stage `cases` and the issue body files.
Handle findings as in steps 3 and 4. An `ask` at this stage stops the flow
the same way.

### 7. Create and report

Do not ask before creating. Both reviews have passed, and the developer reads
the result in the report.

Create the issues with `gh issue create` from the checked bodies, parent
first if there is one, then fill the parent's 子 issue list with the real
numbers. A defect set aside under principle 9 becomes a note issue: 背景 and
how it will be handled, no `To Implementer`, so dispatcher leaves it alone.

Report in one message, Japanese, following `.claude/rules/writing.md`:

- The decision, in a few lines, with a link to the issue that holds the
  record.
- What the reviews found and how it was settled, briefly. List apart anything
  changed after the last review round, since no reviewer has seen it. Include
  anything added to `software-design-theory`, and say that the edit is
  uncommitted.
- How the split was arrived at, in a few lines.
- The issues in the order they should be done: number, title, one line each.
  The build order as a figure when issues depend on one another, and which
  could run in parallel.
- That they can start with `implementer` and an issue number, or `dispatcher`
  for all of them.

After the report, stop.

## Things to keep in mind

- Human-facing issue text (背景, 設計, 対応内容, 制約, ケース) is Japanese and
  follows `.claude/rules/writing.md`. `To Implementer` is the one place
  file names and signatures belong.
- If the developer asks you to "just do it", remind them once that this repo
  works design-first, then follow their call — but still write the issue so
  the decision and its cases are recorded.
- A reason that cites no principle is a preference. Do not write preferences
  into the record as reasons; ask.
