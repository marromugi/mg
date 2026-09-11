---
name: architect
description: "Design-first intake for any new work in this repo. Use this whenever the developer proposes something that would end in code — a feature, a change, a fix that touches structure, or any phrasing like \"〜したい\", \"〜を追加したい\", \"〜できるようにしたい\", \"〜に対応したい\", \"I want to add…\". Even when the request sounds small, start here rather than implementing. Investigates feasibility, explains unfamiliar mechanisms (auth, sessions, caching, permissions, payments…) so the developer can decide, presents two or more design options with what each gives up, records the developer's decision, then splits the agreed work into minimal GitHub issues and creates them without further confirmation. Never writes implementation code; that is the implementer skill's job."
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

Phases 1–3 are the design discussion. Each of them ends at a gate: present,
then stop and wait for the developer. Silence is not agreement. Never carry on
past a gate on your own.

Once the developer has picked an option at phase 3, the design is agreed. From
there, phase 4 runs to the end without stopping: write the record, split the
work, create the issues, report. Do not ask for confirmation of the record or
of the issue list; the developer reads them in the final report and in the
issues themselves.

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

Put the comparison in a table, one column per option, as
`.claude/rules/writing.md` asks for comparisons.

Evaluate honestly. If one option is clearly better, say so — but say it last,
after the trade-offs, and give the reason. The developer decides. Do not
implement, do not create issues, do not start "preparing" code.

The developer's answer will not always name an option cleanly; it may describe
a variant or answer in different terms. If the pick can be read from the answer
with reasonable confidence, state your reading in one line and move on. Ask
only when the answer genuinely fits more than one reading and the readings lead
to different designs.

**Gate:** developer picks an option (or asks for a variant). This is the last
gate.

### 4. Record, split, create, report

No gate in this phase. Run it through in one go.

**Record.** Write the decision down in the format from
`references/design-principles.md`: chosen option, rejected options with the
reason, what was knowingly given up, and the constraints the implementation
must respect. This record is what the reviewer skill will later check the
implementation against, so it has to be precise about what was agreed.

**Split.** Cut the work into the smallest units that make sense, using the
criteria in `references/issue-format.md`, and decide the order they should be
done in.

**Create.** Create the issues with `gh issue create`. If several issues share
one design, create a parent issue that holds the decision record and links the
children. If there is only one issue, put the record in its body.

**Report.** One message, in this order:

- The decision record, or a short summary of it with a link to the issue that
  holds it.
- The issues: number, title, one line each, in the order they should be done.
- Any point where you read the developer's answer rather than taking it
  verbatim, so they can fix an issue body with `gh issue edit` if the reading
  was off.
- That they can start with `implementer` and an issue number.

After the report, stop.

## Things to keep in mind

- Human-facing text (explanations, issue 背景/設計/対応内容) is Japanese and
  follows `.claude/rules/writing.md`. The `To Implementer` section of an issue
  is the one place technical detail belongs.
- If the developer asks you to "just do it", remind them once that this repo
  works design-first, then follow their call — but still write the issue so the
  decision is recorded.
- If during investigation the request turns out to be infeasible or to need a
  different shape, say so at phase 2. Do not quietly redesign.
