# Issue format

The issue is the queue entry dispatcher picks up, and the record the later
steps read: implementer builds from it, reviewer checks the PR against its
`Request`, verifier runs its `Verification`. Keep the headings exactly as
written here; scripts find `Design`, `Verification`, `Child issues`, and the
`Parent:` line by heading.

Issues are written in English: the title, every heading, and every section.
Everything above `To Implementer` is for people, in plain wording with no
file names or function names. `To Implementer` is for the implementing agent
and is as technical as needed.

## When a task gets an issue

- Work that dispatcher will pick up later, or that splits into several
  pieces, gets issues.
- Work finished inside the current session skips the issue. Its body, in
  the single-issue form below, is written to a scratchpad file and handed to
  implementer, which puts it in the PR body.

## Splitting

Split only where the pieces can be built and run on their own. One issue per
piece that a person could try by itself. Order the pieces so each builds on
merged work, and list the order in the parent.

## Single issue, or child of a parent

```
## Request
<what should become possible, from the point of view of whoever uses it.
2–4 sentences. A bug fix says what is seen now and what should be seen.>

## Design
<a child's first line is `Parent: #<n>`, alone. Then the shape in a few
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
`## Background` and `## Handling` and no `To Implementer`, so dispatcher
leaves it alone and `triager` finds it.

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
