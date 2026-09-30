---
name: triager
description: "Take stock of the notes that pile up between design rounds — note issues (titles ending in 「（メモ）」 or \"(note)\", a Background and a handling section, no To Implementer) and any observations or feedback the developer lists in chat — and move each one forward: close what the code no longer has, send the rest to architect to build, and bring to the developer only what software-design-theory sends to them — what to build when unclear, and anything that spends money, cannot be undone, or reaches outside this machine. Ends by handing the resulting issues and PRs to dispatcher. Use this whenever the developer wants the notes or small findings dealt with in bulk — 「メモの issue を棚卸しして」「メモを片づけて」「溜まった気づきを整理して」「メモを消化して」「このフィードバックたちを処理して」「小さいのはやって、大きいのは方針を決めたい」 — even when they do not say \"note\". For one named request with no note behind it use architect; for issues already carrying To Implementer use dispatcher."
---

# Triager

## Why this skill exists

Work leaves things behind. A review finds a defect the issue did not ask
to fix; principle 9 keeps it out of that work, and architect writes it
down as a note issue. The developer notices something while using the
software and says it in passing. None of these has a design yet, so
dispatcher leaves them alone, and they pile up.

Read against today's code, a note is often already gone. Most of the rest
can simply be built: the maker decides the calls the note leaves open. Only
a few need the developer, because what to build is unclear or building it
would cost them something. This skill sorts them by reading the code, moves
the rest on without the developer, and brings those few to the developer
together.

It does not design anything itself. Every design goes through architect,
every merge decision through dispatcher; this skill decides only what to
send where, and closes what no longer exists.

Read `software-design-theory` before step 3.

## Input

- Note issues. With no scope named, every open issue that is a note: the
  title ends in 「（メモ）」 or "(note)", and the body has no
  `## To Implementer` and no `## Child issues`. The developer may instead
  name numbers.
- Observations the developer gives in chat, one item each. They have no
  issue to close; otherwise they are sorted the same way.

An issue that is not a note by the rule above is not this skill's, even
when it looks like one — a 方針 issue with a `## Decision` holds a record,
not a leftover.

## Step 1: Gather

Bring main up to date, then dump the notes into the scratchpad, one file
each, with comments. A note's comments often carry what was learned after
it was written.

```
git fetch origin && git merge --ff-only origin/main
gh issue list --state open --limit 200 --json number,title,body,comments > <scratch>/issues.json
```

Filter with the rule from Input. Also keep every open issue and open PR at
hand; step 2 checks notes against them.

## Step 2: Read each note against the code

Spawn one read-only agent per note (Explore, Opus), all in one message.
Hand each the note's text, the path to the dump of open issues and PRs, and
the questions below. Each answers from the code on main and cites the
lines it read. It does not propose a design.

1. Is the problem still there? `gone` with the code or commit that removed
   it, `covered` with the open issue or PR that already does this work, or
   `present` with where it lives.
2. Does it wait on something? A note that says it waits for another issue
   or a design round (「その回で決めます」) waits while that issue is open.
3. Which roles and interfaces it touches, as file paths and exported
   names. Step 3 groups notes by these.
4. The questions the note itself leaves open, quoted.

## Step 3: Sort

Group first. Notes that touch the same role or the same interface become
one item: principle 1 draws them from the same picture, and designing them
apart lets two issues change one interface two ways. A group takes the
heaviest sort of its members.

Then put every item in exactly one bin.

| Bin | When | What happens |
| --- | --- | --- |
| Gone | `gone` or `covered` | Close in step 4 |
| Waiting | waits on an open issue | Left open, reported |
| Developer | what to build is unclear, or building it costs money, cannot be undone, or reaches outside this machine | Asked in step 5 |
| Build | everything else | architect |

An open question in a note is not a reason for the Developer bin. Names,
values, the shape of a fix, and how a defect is handled are the maker's
(`software-design-theory`, What goes to the developer); architect decides
them and lists them under `Decided`.

Whether a note is worth fixing at all is not asked. A note records a defect
set aside, and fixing it is the work it was set aside for. Ask only when
fixing it would change behaviour someone relies on, which is a call about
what to build.

## Step 4: Close what is gone

Closing an issue can be undone, and a note whose problem no longer exists
records nothing. Close each Gone item with a comment in Japanese that
names the evidence, and do not ask.

```
gh issue close <N> --comment "<消えた根拠: コミットかコード、または同じ仕事をする issue や PR>"
```

## Step 5: Ask the developer

Skip this step when the Developer bin is empty.

Otherwise ask every Developer item at once, with the AskUserQuestion tool,
each reading on its own following `.claude/rules/questions.md`: what is
decided, and the options with what each gives up.
More than four questions go in several calls in a row, without work in
between. Write in Japanese following `.claude/rules/writing.md`.

Always offer leaving the note as it is, as one option. That keeps the note
open, with the question and its options added to it as a comment, so the
next run starts from them.

Each answer turns its item into a Build item with that decision attached,
or leaves it open as above.

## Step 6: Hand to architect

Run architect once per Build item, one at a time, so each is designed from
a main that already has the ones before it. Pass the note's text and its
number, what step 2 found, and for an item that came from step 5 the
developer's answer as a decision already made. Tell architect the work gets
issues, so dispatcher can build them.

When architect has created the issues for an item, close each note the
item came from, with a comment that links them.

```
gh issue close <N> --comment "<引き継いだ issue の番号>"
```

## Step 7: Hand to dispatcher

Invoke `dispatcher` with the issues step 6 created as its scope. It builds
them and decides merge or leave open for every PR.

## Step 8: Report

Report in one message, Japanese, following `.claude/rules/writing.md`:

1. One line: how many notes were read, and how many went to each bin.
2. A table of every note: number, title, bin, and what became of it — the
   evidence it was closed on, the issue it waits for, or the issue and PR
   it went to.
3. For each Developer item, the decision the developer made.
4. What dispatcher reported, as it returned it.
5. Notes left open, with the reason each is still open.

After the report, stop.
