# Several notes at once

Work leaves notes behind: a defect set aside under principle 9, or
something the developer said in passing. Read against today's code, a note
is often already gone. Most of the rest can simply be built. Only a few
need the developer.

## Input

- Note issues. With no scope named, every open issue whose title ends in
  「（メモ）」 or "(note)" and whose body has no `## To Implementer`, no
  `## Child issues`, and no `## Open questions`. The developer may instead
  name numbers.
- Observations the developer lists in chat, one item each. They have no
  issue to close; otherwise they are sorted the same way.

## 1. Gather

Bring main up to date, then dump the notes with their comments into the
scratchpad. A note's comments often carry what was learned after it was
written.

```
gh issue list --state open --limit 200 --json number,title,body,comments > <scratch>/issues.json
```

Keep every open issue and open PR at hand for step 2.

## 2. Read each note against the code

Spawn one read-only agent per note (Agent tool, `subagent_type`:
`Explore`), all in one message. Each answers from the code on main, cites
the lines it read, and proposes no design:

1. Is the problem still there? `gone` with the code or commit that removed
   it, `covered` with the open issue or PR that already does this work, or
   `present` with where it lives.
2. Does it wait on an open issue?
3. Which roles and interfaces it touches, as file paths and exported names.

## 3. Sort

Notes that touch the same role or interface become one item, drawn from
the same picture. Then each item goes in one bin:

| Bin | When | What happens |
| --- | --- | --- |
| Gone | `gone` or `covered` | Closed with the evidence, without asking |
| Waiting | waits on an open issue | Left open, reported |
| Developer | `software-design-theory`, What goes to the developer, sends it there | Asked |
| Build | everything else | Framed as a goal |

An open question in a note is not a reason to ask. Whether a note is worth
fixing is not asked either; fixing it is what it was set aside for.

Close each Gone item:

```
gh issue close <N> --comment "<消えた根拠: コミットかコード、または同じ仕事をする issue や PR>"
```

Ask every Developer item at once with AskUserQuestion, each reading on its
own following `.claude/rules/questions.md`. Always offer leaving the note
as it is; that adds the question to the note as a comment. An answer turns
the item into a Build item with the decision under `Bounds`.

## 4. Frame and drive, one at a time

For each Build item in turn, run this skill's flow with the note's text as
`Asked`, then let `lead` drive it to done before the next item starts, so
each is framed from a main that has the ones before it. Close each note
the item came from with a comment naming the goal issue.

## 5. Report

Add to the report: how many notes went to each bin, a table of every note
with its bin and what became of it, each developer decision, and what lead
returned for each item.
