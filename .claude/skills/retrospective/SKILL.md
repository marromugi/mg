---
name: retrospective
description: "Look back over a day's Claude Code sessions in this repo, find every place the developer overrode, corrected, or redirected a design the agent had proposed, trace each one to the gap in software-design-theory or in the architect / implementer / reviewer / dispatcher flow that let it happen, and rebuild those skills so the gap is gone. The goal is an agent that designs and implements with no developer in the loop; each override is a measured distance from that goal. Use this whenever the developer wants to learn from the day's work — 「今日のセッションを振り返って」「今日テコ入れしたところを洗い出して」「設計論を見直したい」「なぜ私が直すことになったか調べて」「昨日の分を振り返って」「スキルの改善点を探して」, or any phrasing that means 'where did I have to step in, and what should change so I do not have to next time'."
---

# Retrospective

## Why this skill exists

The aim of this repo's skills is an agent that designs and implements on its
own. `software-design-theory` is the written form of the developer's design
intent, and the agent is autonomous exactly as far as that text produces the
design the developer would have picked. Every time the developer steps in and
changes a design the agent proposed, the text fell short, and the transcript
shows where.

This skill reads the day back, finds those places, and rebuilds the theory
and the flow skills so that the same situation would now come out the
developer's way.

It rebuilds; it does not append. A theory that grows by one ruling per
override turns into a list of past incidents: rulings overlap, contradict
each other at the edges, and the agent stops being able to hold the whole.
So nothing learned here is stored as a case or a log. What is learned goes
into the wording of the principles, and the principles are reshaped until
they state the old understanding and the new one as a single idea.

## Steps

### 1. Sort the day's turns

Transcripts are megabytes. The script reads them, keeps only what the
developer said, pairs each message with the agent reply it responds to, and
asks an Estimator one yes/no question about each pair: did the developer
override a design choice the agent had proposed or made. Pairs above the
threshold are printed in full; the rest are one line each with their
probability.

The agent side of a pair is the last text the agent wrote before the
developer spoke. Progress notes written between tool calls are left out, so
the Estimator judges the reply the developer was actually answering.

```
pnpm --filter @mg/core build
node .claude/skills/retrospective/scripts/retrospect.mts --date <YYYY-MM-DD> --exclude <this session's id> > <scratchpad>/turns.md
```

Run it from the main checkout. The date is local and defaults to today; for
a range, run it once per day. This session's id is the last directory but one
in the scratchpad path.

The Estimator is Jev, and the script needs `TYPESAFE_API_KEY`. If the key is
missing, tell the developer and stop. `--all` prints every turn unjudged; use
it only when the developer asks for a run without the Estimator, because then
the sorting in step 2 is yours alone and costs several times the reading.

The Estimator sorts; it does not decide. Its question is in
`scripts/judge.mts`. When it keeps missing a kind of override, or keeps
flagging something that is not one, fix the question there — that is part of
this skill's own upkeep. The scripts are TypeScript that Node runs as it
is; after changing one, check the types:

```
pnpm exec tsc -p .claude/skills/retrospective/tsconfig.json
```

Each turn has an id like `c062c844#3`. Under it the script prints the UTC
timestamp, the skill last loaded in that session, and whether the developer
had just interrupted the agent.

### 2. Confirm the interventions

Read the full-printed turns and decide which really are interventions: the
agent had proposed, recommended, or already made a design choice, and the
developer changed it. That covers a rejection or redirect, a constraint the
proposal had not considered, a non-recommended answer, an interruption
followed by a different instruction, a rename, a moved responsibility, a
changed interface or failure behaviour, a changed flow between skills, and a
correction to a skill's wording that had led the agent astray.

Not interventions: a go-ahead, a new request, a factual answer the agent
could not have known, an operational instruction, and the goal or scope of
the work — those are the developer's by the theory and always will be.

Scan the one-line list too. A line near the threshold whose text looks like
a correction deserves a look.

Be strict. A retrospective padded with turns that were not overrides leads to
changes the theory did not need.

### 3. Reconstruct each intervention

Establish three things, quoting the transcript:

- what the agent proposed, and the reason it gave;
- what the developer chose instead;
- the developer's reason, in their own words. If they gave none, say so
  rather than inventing one.

When the clipped agent text does not show the proposal, pull the surrounding
entries from the transcript with the printed UTC timestamps. The transcript
directory is `~/.claude/projects/` plus the main checkout's path with every
`/` and `.` replaced by `-`.

```
jq -c 'select(.timestamp >= "<from>" and .timestamp <= "<to>" and (.isSidechain|not))
  | {type, text: ([.message.content[]? | select(.type=="text") | .text] | join("\n"))}
  | select(.text != "")' ~/.claude/projects/<project dir>/<session id>.jsonl
```

Never slice a transcript by line range; one line can be enormous.

### 4. Trace the cause

Read `software-design-theory` and the skill that was driving. A turn with no
skill loaded is plain conversation; its cause can only be in the theory.

| Cause | What it looks like | What changes |
|---|---|---|
| Not applied | A principle covers it, and the agent did not follow it. | The flow: the step or review lens that should have caught it. |
| Misread | A principle covers it, but its wording allows the agent's reading. | The wording of that principle, if step 5 lets it in. |
| Not covered | No principle speaks to it. | The theory, at the principle nearest to the reason, if step 5 lets it in. |
| Developer's call | A product or preference call, or context only the developer had. | Nothing. |

Then check whether it is already dealt with:

```
git log --since=<date> --stat -- .claude/skills .claude/rules
git diff -- .claude/skills .claude/rules
```

- Do not trust the agent's own claim that it wrote an answer back. Search
  the theory for the ruling. A claimed write-back that is not there is an
  open finding.
- A rule that lives only in the memory index does not close a gap in a
  skill. Subagents and other sessions read the skill, not the memory.
- Uncommitted edits carry no date. When a session runs past midnight, find
  when a line was written from the transcript's Edit and Write calls.

Some sessions are about the theory or the skills themselves. There the
developer's corrections are the design work, not overrides of it. Check that
each ended up in the file and move on.

### 5. Decide what belongs in the theory

For each open finding caused by a misread or by a gap, decide whether it
makes general software design before drafting anything. A "not applied"
finding skips this step; its principle is already in the theory. A finding
goes on to step 6 only when it passes all three:

1. The developer's reason can be said as one sentence about software design
   that names no package, product or business term, and no vendor. If it
   cannot, it is about this product.
2. Two kinds of software outside this repo can be named where the sentence
   decides a design, with what it decides in each. If none can be named, or
   any reasonable design would reach the same result without it, it adds
   nothing.
3. A review lens can be named that would check it. A viewpoint no lens can
   check will not be applied.

A finding that fails is the developer's call. The report says which check it
failed.

### 6. Draft the rebuild

For each finding that step 5 let through, and each "not applied" finding,
draft the change to the skill files. Draft only; no
skill file is edited until the developer has chosen (step 9). Write each
draft to the scratchpad as the passage it replaces and the passage that
replaces it, for every file it touches. Work on the theory the way the theory
asks code to be worked on: no stopgaps — the result is what would have been
written had this been understood from the start.

- Start from the developer's reason, not from the incident. Ask what general
  understanding makes the developer's choice the obvious one, and whether the
  nearest principle, fully understood, already implies it.
- If it does, the principle's wording is what failed. Rewrite the principle
  so the implication is plain. Do not add a sentence under it that patches
  this one case.
- If it does not, widen or re-cut the principle so that one statement covers
  what it covered before and the new ground. Add a new principle only when no
  existing one is near, and then look at whether two existing ones should
  merge, so the count does not only go up.
- Read the whole file as it would stand with the draft in it. Remove what the
  new wording would make redundant. Resolve anything it would contradict. Two
  passages that say overlapping things become one.
- Keep incidents out of the text. No turn ids, no dates, no "after the
  developer pointed out". An example is fine when it teaches the principle;
  it is written as an example, not as history.
- Carry the change through: the review lenses in the same file, the architect
  flow, the issue format, the reviewer's design pass, the reviewer prompts.
  A principle no lens checks will not be applied.
- For a "not applied" finding, draft the change to the flow skill at the step
  where the principle should have bitten, with the same care: reshape the
  step, do not bolt a reminder onto it.

When the evidence is thin — the developer gave no reason, or the reason could
generalise two ways — do not pick one reading to draft. Guessing a principle
into the theory is worse than leaving a gap, because every later design will
follow the guess. The finding still goes to the developer in step 8, with the
readings as its options.

### 7. Check the drafts

For each intervention behind a draft, read the situation again as the agent
met it, with only the files as the drafts would leave them, and ask whether
they now lead to the developer's choice. If it takes knowing the incident to
get there, the wording is still too weak; go back to step 6.

Then check the other direction: look for a past decision recorded in the
theory, or a design already in the repo, that the new wording would now
judge wrong. A rebuild that fixes today by breaking last week is not done.

### 8. Report and ask

Japanese, following `.claude/rules/writing.md`. Turn ids and skill names may
appear inline. Order:

1. What was looked at: the date, how many sessions and turns, how many
   interventions, how many were already closed.
2. A table of the interventions: id, the skill that was driving, what the
   agent proposed, what the developer chose, the cause, and what is proposed.
3. The proposed rebuild: per file, what the text says now, what the draft
   would make it say, and which interventions it answers.
4. Interventions left as the developer's call, one line each, with the
   step 5 check that failed where one did.

Then put every change to a skill file to the developer, the way `architect`
step 4 puts its questions: the AskUserQuestion tool, one entry per change.
That covers each draft, each finding whose evidence was thin, and any change
to this skill or its scripts. A draft's options are to apply it as drafted,
the other readings the finding allows, and leaving it unedited; recommend the
draft when step 7 passed. A thin finding's options are its readings and
leaving it unedited, with no recommendation. The report itself carries no
questions in prose. Wait for the answers.

### 9. Apply

Edit the skill files as the developer chose, and nothing more. When an answer
picked a reading other than the draft, draft that reading and check it as in
steps 6 and 7 before editing. Leave the edits uncommitted; the developer reads
the diff.

## Things to keep in mind

- The transcript is the evidence. Quote it; do not paraphrase a developer
  reason into something tidier than what was said.
- A day with no interventions is a result. Say so in one line and do not go
  looking for weaker signals to justify an edit.
- The measure of this skill is that the theory gets better without getting
  longer. If a retrospective only ever adds lines, it is appending, not
  rebuilding.
- Subagent transcripts are left out on purpose. The developer does not talk
  to subagents, so an override never happens there.
