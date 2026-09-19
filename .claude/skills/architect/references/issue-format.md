# Issue format

The issue is the interface between architect and everything after it. The
implementer agent builds from it, the reviewer judges the PR against it, and a
script checks its shape. Keep the headings exactly as written here; other
skills and the script find sections by heading.

## Why issues are small

The developer meets the issues in the report, as a title and one line each,
and does not read each body. The
design was judged by `software-design-review`, and the issue has to carry
that design without loss. Small issues keep the one-line summary honest and
keep each one checkable: one narrow design, a handful of constraints, the
cases that receive them.

An issue is small enough when all of these hold:

- It carries one design decision, or none (pure follow-through).
- It can be verified on its own, without the other issues done.
- 対応内容 fits in a few bullets.
- It has a single clear owner module or boundary.

If any fails, split further. Order the issues so each one builds on merged
work; note the order in the parent.

Work that only cuts interfaces is a valid issue. It has no behaviour
constraints and no cases; the type check is its verification
(`software-design-theory`, Tests).

## Decision record

One record per design. It goes in the parent issue when several issues share
the design, and in the single issue otherwise.

```
## 決定
<the design, in a few sentences>

## 変わる振る舞い
- <each change in what the user of the software observes, stated as a
  decision. `- なし` when nothing changes. What is not listed stays as it is.>

## 全体の中の位置
<the roles in the whole software that this touches, and where this piece
stands among them. Name the interfaces this design cuts or relies on.>

## 理由
- 原則 <n>: <how the design follows it>

## 見送った形
- <shape>: 原則 <n> に照らして見送りました。<one sentence why>

## 手放したもの
- <what this design knowingly does not do>
```

Every reason and every rejection cites a principle of
`software-design-theory` by number. A reason that cites none is a preference,
and preferences belong to the developer: raise it as a question instead of
writing it down as a reason.

## Constraints and cases

```
## 制約

### 振る舞い
- B1: <what the user of the piece observes>

### 構造
- S1: <dependencies, packages, types that stay as they are>

### 向き
- D1: <which way the design leans where the code could go either way>

## ケース
- C1 [B1]: <what is done, and what is seen. The pass condition, with literal values.>
- C2 [B1, B2]: ...
```

- Ids are `B`, `S`, `D`, `C` followed by a number, unique within the issue.
- A behaviour constraint lives in the issue that implements it, never in a
  parent. Structure and direction constraints that hold for every child live
  in the parent, under the same headings, and are not repeated in children.
- Every `B` is received by at least one case. Every case names the `B` ids it
  receives in brackets.
- A subsection with nothing in it is written as `- なし`.
- Write cases from what the user of the piece sees
  (`software-design-theory`, Cases). A case that can only be stated in terms
  of the implementation's insides is a sign the constraint is not a behaviour.

## Issue body

The Japanese sections follow `.claude/rules/writing.md` and carry no file
names or function names. `To Implementer` is for the implementer agent and is
as technical as needed.

```
## 背景
<what problem this solves and why now — 2–4 sentences>

## 設計
<the design this issue follows and the boundary it lives in. Link the parent
if there is one. If there is none, the decision record goes here instead.>

## 対応内容
- <what changes, from the user's or developer's point of view>

## 制約
...

## ケース
...

## To Implementer
- Files / modules: ...
- Interfaces (signatures, data shapes): ...
- Behaviour on failure: ...
- Structural checks: <the command that shows each S holds>
- Out of scope (do not touch): ...
- Acceptance: every case passes, every structural check passes, plus <...>
```

`To Implementer` does not list tests. The cases are the tests.

## Parent issue

```
<decision record>

## 制約
<shared 構造 and 向き only>

## 子 issue
1. #<n> <title>
2. ...
```

Child issues link to the parent in their 設計 section.

## Checking and creating

Write each body to a file in the scratchpad, check it, then create:

```
node .claude/skills/architect/scripts/check-issue.mjs <body.md>
gh issue create --title "<title>" --body-file <body.md>
```

The script prints one line per problem and exits non-zero. Fix every line
before creating. Titles are short Japanese noun phrases that say what changes.
