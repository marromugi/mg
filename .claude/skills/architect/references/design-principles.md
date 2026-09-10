# Design principles and how to present a decision

Read this before writing design options. It is also read by the reviewer skill
to judge whether an implementation kept to the agreed design.

## Qualities to evaluate

Each quality has a question to ask and a cost. Every quality has a cost; a
design that maxes all of them does not exist, which is why the developer chooses.

| Quality | Question to ask | What it costs when pushed too far |
|---|---|---|
| Clear responsibility | Can you say in one sentence what each module is for, and nothing else? | More modules, more plumbing between them. |
| Localised change | If this requirement changes later, how many files move? | Extra indirection to keep things apart. |
| Testability | Can each piece be tested without the rest running? | Interfaces and injection that exist only for tests. |
| Explicit boundaries | Are database, network, and external services behind a seam? | Adapter code that mirrors the thing it wraps. |
| Defined failure | Is it decided what happens when each step fails? | More branches, more states to test. |
| Reversibility | If this turns out wrong, how hard is it to back out? | Choosing the less direct option now. |
| Simplicity | Is there a version with fewer parts that still meets the goal? | Less room to grow without a rewrite. |
| Extensibility | Where is the next feature likely to plug in? | Abstractions for cases that may never come. |

When presenting options, score each one on the qualities that matter for this
request. Do not list all eight every time; pick the ones the decision turns on.

## How to present options

For each option:

```
### 案 A: <name>
<one or two sentences: what it is>

得るもの
- ...

失うもの
- ... (and when this loss would hurt)

観点
- 責務の明確さ: ...
- テスト容易性: ...
```

Then, optionally, a recommendation with the reason — after the options, never
before. The developer may pick the option you did not recommend; that is the
point.

## Decision record format

```
## 決定
<chosen option, one sentence>

## 理由
<why this one, in terms of the qualities above>

## 見送った案
- 案 B: <why not>

## 承知の上で手放したもの
- ...

## 実装が守る制約
- ... (interfaces, boundaries, things the implementer must not change)
```

This block goes into the parent issue (or the single issue if there is only
one). The reviewer compares the implementation against 「実装が守る制約」.
