# Issue format and the minimal-unit rule

## Why issues are small

The developer sees the split as a plan before the issues exist: a title and
one line per issue, plus the build order. They judge the cut from that
summary, and read each full body only when handing it to the implementer
skill. If an issue holds several decisions, the one-line summary hides them,
the developer skims the bundle without really checking each one, and
disagreement shows up after implementation. Small issues keep each one
judgeable at a glance, both in the plan and in the body, and let the reviewer
skill check a PR against one narrow design.

## Minimal-unit criteria

An issue is small enough when all of these hold:

- It contains exactly one design decision, or none (pure follow-through).
- It can be tested on its own, without the other issues done.
- The developer can judge right/wrong at a glance — the 対応内容 section fits
  in a few bullets.
- It has a single clear owner module or boundary.

If any fails, split further. Order the issues so each one builds on merged
work; note the order in the parent issue.

## Issue body

Two audiences read an issue. The first three sections are for the developer:
Japanese, plain language, following `.claude/rules/writing.md`, no code-level
detail. The last section is for the implementer agent: as technical as needed.

```
## 背景
<what problem this solves and why now — 2–4 sentences>

## 設計
<the design this issue follows: which option, the boundary it lives in,
what it must not touch. Link the parent issue if there is one.>

## 対応内容
- <what changes, from the user's or developer's point of view>
- ...

## To Implementer
- Files / modules: ...
- Interfaces (signatures, data shapes): ...
- Behaviour on failure: ...
- Tests to add and what they assert: ...
- Out of scope (do not touch): ...
- Acceptance: <how we know it is done>
```

Keep 対応内容 free of file names and function names. The implementer needs
them; the developer does not.

## Parent issue

When several issues share one design, the parent issue holds:

- The decision record (from `design-principles.md`).
- The list of child issues in execution order.

Child issues link to the parent in their 設計 section.

## Creating issues

```
gh issue create --title "<title>" --body-file <path>
```

Write each body to a file first (scratchpad), then create. Titles are short
Japanese noun phrases that say what changes.
