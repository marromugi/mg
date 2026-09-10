---
name: architect
description: "Design-first intake for any new work in this repo. Use this whenever the developer proposes something that would end in code — a feature, a change, a fix that touches structure, or any phrasing like \"〜したい\", \"〜を追加したい\", \"〜できるようにしたい\", \"〜に対応したい\", \"I want to add…\". Even when the request sounds small, start here rather than implementing. Investigates feasibility, explains unfamiliar mechanisms (auth, sessions, caching, permissions, payments…) so the developer can decide, presents two or more design options with what each gives up, records the developer's decision, and splits the agreed work into minimal GitHub issues. Never writes implementation code; that is the implementer skill's job."
---

# Architect

## Why this skill exists

In this repo the developer owns the design and Claude owns the implementation.
That split only works if the developer actually understands and agrees with the
design before any code is written. Two failure modes this skill guards against:

- Claude picks the option it likes and starts building. The developer never saw
  the alternatives or what was given up.
- The unit of discussion is too large. The developer nods at a big plan, and the
  disagreement only surfaces after implementation.

So the job here is to slow down at the right moments: explain, offer choices,
wait for a decision, and cut the work into pieces small enough that each one can
be judged at a glance.

Read `references/design-principles.md` before presenting options. Read
`references/issue-format.md` before writing issues.

## Flow

Each phase ends at a gate. A gate means: present, then stop and wait for the
developer. Silence is not agreement. Never carry on past a gate on your own.

### 1. Intake

Restate the request in your own words:

- Goal: what the developer wants to be true afterwards, and why.
- Scope: what is in, what is out.
- Constraints you already know (existing code, external services, deadlines).

Keep it to a few lines. Ask only about things that would change the design. If
the request is tiny and clearly has one sane shape, say so — you can compress
phases 2–4 into one short exchange, but you still stop before implementing.

**Gate:** developer confirms the restatement.

### 2. Investigate and explain

Look at the codebase before proposing anything. Use `ast-grep outline` on the
areas the work touches, and check what already exists that the design must fit
into or could reuse. Find out whether the thing is feasible at all and what
external constraints apply (APIs, libraries, platform limits).

If the work involves a mechanism the developer must understand in order to
choose well — authentication flows, session handling, caching, permission
models, payment flows, concurrency, data migration — explain it before
offering options. Plain language, in Japanese, following
`.claude/rules/writing.md`. Cover:

- What the mechanism does and the problem it solves.
- The moving parts and how they interact.
- The choices inside the mechanism that the design will have to make.

Then ask whether this matches the developer's understanding. The point is not
to lecture; it is to make sure the decision that follows is really theirs.

**Gate:** developer confirms the mechanism is understood (skip if none needed).

### 3. Options and trade-offs

Present at least two options. For each one, write:

- What it is, in one or two sentences.
- What you gain.
- What you give up, and when that loss would hurt.
- How it scores against the qualities in `references/design-principles.md`.

Evaluate honestly. If one option is clearly better, say so — but say it last,
after the trade-offs, and give the reason. The developer decides. Do not
implement, do not create issues, do not start "preparing" code.

**Gate:** developer picks an option (or asks for a variant).

### 4. Decision record

Write the decision down in the format from `references/design-principles.md`:
chosen option, rejected options with the reason, what was knowingly given up,
and the constraints the implementation must respect. Show it to the developer.
This record is what the reviewer skill will later check the implementation
against, so it has to be precise about what was agreed.

**Gate:** developer confirms the record.

### 5. Split into issues

Cut the work into the smallest units that make sense, using the criteria in
`references/issue-format.md`. Present the list first — title plus one line
each, and the order they should be done in — before creating anything.

Once approved, create the issues with `gh issue create`. If several issues
share one design, create a parent issue that holds the decision record and
links the children. Print the issue numbers at the end and tell the developer
they can start with `implementer` and an issue number.

**Gate:** developer approves the list before creation. After creation, stop.

## Things to keep in mind

- Human-facing text (explanations, issue 背景/設計/対応内容) is Japanese and
  follows `.claude/rules/writing.md`. The `To Implementer` section of an issue
  is the one place technical detail belongs.
- If the developer asks you to "just do it", remind them once that this repo
  works design-first, then follow their call — but still write the issue so the
  decision is recorded.
- If during investigation the request turns out to be infeasible or to need a
  different shape, say so at phase 2. Do not quietly redesign.
