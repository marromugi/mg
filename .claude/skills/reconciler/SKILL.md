---
name: reconciler
description: "Find conflicts between open GitHub issues before anyone builds them: one issue removes or renames something another issue builds on, two issues change the same interface in different directions, one issue's decision is another's rejected shape, the build order contradicts itself, or two issues do the same work. Settles what software-design-theory settles, asks the developer the rest with AskUserQuestion, and hands every resolution to architect's \"Redoing a design\" so the issues get rewritten. Use this whenever the developer wants the backlog checked for contradictions — 「issue の競合を見て」「矛盾している issue がないか確認して」「この issue とぶつかるものはある？」「削除の issue に依存している issue がないか」「backlog を精査して」 — and after architect creates issues, to check the new ones against everything already open. Not for merge conflicts in git, and not for reviewing one design on its own (software-design-review does that)."
---

# Reconciler

## Why this skill exists

architect designs one request at a time, from the picture of the code on
main. It does not see the issues other requests left open. So two issues
can each be sound and still contradict each other: one removes a package,
and another, written a week earlier, adds a feature to it. Whoever builds
the second one finds out halfway, or worse, builds it and the first one
removes it again.

This skill looks across the open issues for such contradictions, while
they are still text and cheap to change. It finds and confirms them, and
decides the ones the theory decides. It does not redesign anything: every
resolution goes to architect's "Redoing a design", which owns every edit
to an issue's design. The one exception is closing an issue the developer
chose to drop, which is their decision carried out, not a design.

Read `software-design-theory` before step 5.

## Input

- Called directly: the scope the developer names — a parent, a list of
  numbers, or nothing, which means every open issue against every other.
- Called from architect after step 7: the numbers of the issues it just
  created. Compare each of them against every other open issue. Skip
  pairs where both are new children of the same parent; one design
  review already saw them together.

## Step 1: Gather

Bring main up to date and dump the open issues and open PRs into the
scratchpad. Nothing from an earlier run is reused; issues change between
runs.

```
git fetch origin && git merge --ff-only origin/main
gh issue list --state open --limit 200 --json number,title,body > <scratch>/issues.json
gh pr list --state open --json number,title,body,files > <scratch>/prs.json
```

Open PRs count as work in flight. A PR that implements what another issue
removes is the same conflict as two issues, and more urgent.

## Step 2: Write a card per issue

For each issue in scope, read its body and write a short card to the
scratchpad. The card is what the pairwise comparison reads, so it holds
names, not prose:

- 消す・改名する: packages, modules, exports, types, commands, files,
  behaviours the issue removes or renames, with the new name.
- 足す: what it adds.
- 変える: interfaces and behaviours whose shape changes, and to what.
- 前提: what it uses or builds on that must already exist, by name.
- 決定と見送った形: from the issue or its parent's decision record.
- 順序: its parent and its place in the parent's `子 issue` list, and any
  issue it says it waits for.

Take names from `To Implementer` (`Files / modules`, `Interfaces`,
`Out of scope`) and from `設計` and `対応内容`. A note issue (背景 only, no
`To Implementer`) still gets a card: it records a known plan or defect,
and a new issue can make it wrong.

A name the issue implies but does not spell out goes on the card too. An
issue titled after a package builds on that package even when no file
path says so.

## Step 3: Find candidate conflicts

Compare the cards pair by pair, using the kinds in the table below. Match
names literally first (`grep` the cards for each name on a 消す card),
then read for the kinds a name match cannot catch.

| 種類 | 見つけ方 |
|---|---|
| 消すものに依存 | A の消す・改名するに、B の前提か変えるが含まれる |
| 同じものを別方向に変える | A と B の変えるが同じ名前を指し、形が違う |
| 決定の食い違い | A の決定が、B の見送った形に入っている |
| 順序の矛盾 | 待ち合わせが循環している、または親の順番と逆になっている |
| 重複 | A と B の足すか変えるが、同じことを指している |
| 進行中の PR とぶつかる | 開いている PR の変更が、ほかの issue の消すや変えると重なる |

## Step 4: Confirm each candidate

A candidate is a guess from two texts. Before it goes further, confirm it
against the code on main and the issues' own words:

- Read the code the names point at. A package the card says B builds on
  may already be gone from main, or may not be what B means.
- Check whether the issues already account for each other: B waits for A
  in its parent's order, B's text uses the new name, or one issue's
  `Out of scope` fences off exactly this. Then it is not a conflict.
- Write down the evidence: both issue numbers, the sentence in each that
  collides, and the file on main if one is involved.

Drop what does not hold. What remains is a conflict.

## Step 5: Sort each conflict

Hold each conflict against `software-design-theory` ("How to use this"
and "What still goes to the developer"):

- Settled by a principle. The resolution follows from the principles and
  both issues' goals stay whole. For example, B builds on a name A
  renames, and B's goal does not depend on the old name: B should follow
  the new name and wait for A. Write the resolution and the principle.
- A fact running something would settle, such as whether an API B needs
  survives A's change. Send it to `prototyper` and sort again on the
  answer.
- Goes to the developer. The conflict touches the goal or scope of either
  issue: one of them has to give up part of what it set out to do, or
  both issues' goals cannot hold at once. Dropping an issue is always
  this kind. So is a collision between principles the theory does not
  settle.

When unsure between the first and the last, it goes to the developer.

## Step 6: Ask the developer

Skip this step when nothing goes to the developer.

Otherwise stop here, once, with all of them. Write a short message first,
in Japanese following `.claude/rules/writing.md`: how many conflicts were
found, and which ones were settled by the theory, one line each with the
principle. Then put the questions with the AskUserQuestion tool, one entry
per conflict. It takes up to 4 at a time; with more, call it again after
the answers. For each question:

- The question states both issues by number and title, and what collides,
  in plain words. A term the issues coined, like 「足すツール」, is shown on
  the code its user would write, with the path; the developer reads the
  question without the issue open, and a coined term read cold means
  something else.
- Each option is one way out: which issue changes, drops part of its
  goal, or waits, and what it gives up. When one issue would be closed,
  say so in the option.
- Recommend an option only when a principle leans towards it, and name
  the principle in its description. When none does, recommend nothing.

What does not fit in the tool — the colliding sentences, the code on main
— goes in the message before the call.

Wait for the answers.

## Step 7: Hand the resolutions to architect

Group the resolutions, from the theory and from the developer, by the
issue whose design has to change. Then:

- An issue the developer chose to drop: close it with a comment that
  names the conflict and the decision.

  ```
  gh issue close <N> --comment "<競合の相手と、決まったこと>"
  ```

- Everything else: invoke architect's "Redoing a design" once per
  affected parent (or per issue with no parent). Pass the issue numbers,
  the conflict with its evidence as facts, and each resolution as a
  decision already made, naming whether a principle or the developer made
  it. There is no open question to pass.

Closing comes first, so architect reads the backlog as it now stands.

## Step 8: Report

Report in one message, Japanese, following `.claude/rules/writing.md`:

- How many issues were compared, and how many conflicts were found.
- Each conflict: the two issues, what collided, and how it was resolved,
  by which principle or by the developer.
- What architect returned for each: `redone` with the edited issues, or
  `stopped` with its question.
- Candidates dropped in step 4, one line each with why, so the developer
  can see what was looked at.

When called from architect, return this as the section architect's report
includes instead of sending it separately.

With no conflicts, say so in one line, with the number of issues compared.
