# Issue format

The issue is the record the later steps read: lead drives it to done,
implementer builds each step from a body in this format, reviewer checks
the PR against its `Request`, verifier runs its `Verification`. Keep the
headings exactly as written here; scripts find `Design`, `Verification`,
`Child issues`, `Open questions`, and the `Parent:` line by heading.

Issues are written in English: the title, every heading, and every section.
Everything above `To Implementer` is for people, in plain wording with no
file names or function names. `To Implementer` is for the implementing agent
and is as technical as needed.

## Which form

- **Goal issue.** The default for anything left to lead. It fixes only
  what should become possible and how to tell it is done; lead decides the
  steps one round at a time, from the facts it finds.
- **Single issue.** Work whose every fact is already in hand and that is
  one step. lead builds it as its first step.
- **Body file, no issue.** Work finished in this session, in the
  single-issue form, written to a scratchpad file and handed to
  implementer, which puts it in the PR body. lead writes one of these for
  every step it builds.

New parents with child issues are not written; work that would split goes
in a goal issue, and lead finds the pieces as it goes. Existing parents
are still driven by lead.

## Goal issue

```
## Asked
> <the developer's words, exactly as they said them, in their language; or
> the note's text when the goal came from a note>

## Request
<what should become possible, from the point of view of whoever uses it.
2–4 sentences.>

## Verification
- V1: `<entry>`. <steps>. <the pass condition>

## Known
- <a fact the goal rests on>: <how it was seen — file:line, a run, a URL>

## Open questions
- <an unknown that decides how the goal is reached>

## Bounds
- <what must not change, or a call the developer made>
```

- `Asked` is never paraphrased or translated. It is what lead and the
  maker check a move against (`software-design-theory`, How far the maker
  goes alone); `Request` is the maker's reading of it.
- `Verification` needs at least one runnable check; `None` is an error in
  a goal, since lead could never tell it is done.
- `Known`, `Open questions`, and `Bounds` take `- None` when empty.
- `Bounds` holds every call the developer made for this goal, so later
  rounds can read them.
- `Known` holds only facts with their evidence. A guess goes under
  `Open questions`.
- No `Design`, `Decided`, or `To Implementer`. Those belong to each step's
  body, written right before it is built.

## Single issue, or child of a parent

```
## Request
<what should become possible, from the point of view of whoever uses it.
2–4 sentences. A bug fix says what is seen now and what should be seen.>

## Design
<a child's first line is `Parent: #<n>`, alone; a step lead writes starts
with `Goal: #<n>`, alone. Then the shape in a few
sentences: which role this piece plays and the interfaces it relies on or
adds.>

## Decided
- <a name, value, format, or wording the maker chose>: <the choice>
- <a fact settled by running something>: <what was seen, and how it was run>

## Verification
- V1: `<entry>`. <steps>. <the pass condition, with the values seen as they are>

## To Implementer
- Files / modules: ...
- Interfaces (signatures, data shapes): ...
- Behaviour on failure: ...
- Out of scope (do not touch): ...
```

- `Decided` is `- None` when the maker chose nothing the developer might
  want to overturn.
- `Verification` items take one of these forms:
  - `- None` — the work changes no behaviour.
  - `- None: <reason>` — it changes behaviour, but no entry reaches it.
  - `- V<n>: ...` — one runnable check. The entry is a path from the repo
    root, with the entry's declaration next to it. Run
    `node .claude/scripts/entries.mjs show <entry>` and put the declared
    command in the item. When this work adds the entry, `To Implementer`
    says to add its declaration.
- Tests are not listed. implementer writes them for the behaviour in
  `Request` (`software-design-theory`, Tests).

## Parent issue

Kept for the parents already open; architect writes no new ones.

```
## Request
<the whole of what should become possible>

## Design
<the shape shared by every child, in a few sentences>

## Decided
- ...

## Child issues
1. #<n> <title>
2. ...
```

A child has exactly one line `Parent: #<n>` in its `Design`, on its own and
outside code fences. A line that starts with `Parent:` in any other form is
an error. Fenced lines never count.

## Note issue

A defect or idea set aside for later. Its title ends in "(note)", and it has
`## Background` and `## Handling` and no `To Implementer`, so lead
leaves it alone and architect takes it up with the other notes
(`references/notes.md`).

## Checking and creating

Write each body to a scratchpad file, check it, then create:

```
node .claude/skills/architect/scripts/check-issue.mjs <body.md>
gh issue create --title "<title>" --body-file <body.md>
```

The script prints one line per problem and exits non-zero. Fix every line
before creating. Titles are short English noun phrases that say what
changes.

Issues written in the earlier format — with `Background`, `Changes`,
`Constraints`, `Cases`, or a decision record — are still built as they are.
Their `Cases` are read as behaviour the request asks for.
