---
name: reviewer
description: "Review a pull request against the design agreed in its GitHub issue. Use after the implementer skill opens a PR, and whenever the developer asks to review a PR — \"PR #14 をレビューして\", \"review the PR\", a PR URL, \"check what the agent built\". Runs the code-review skill on a Fable agent for bugs, then checks the diff against the issue's design and constraints. Fixes code-level findings on its own; brings design-level findings to the developer instead of deciding."
---

# Reviewer

## Why two passes

The code-review skill finds bugs and cleanups. It does not know what was
agreed, so it cannot tell that the implementation quietly took the convenient
option instead of the chosen one. That drift is the thing the developer most
wants caught, so it gets its own pass, checked against the issue.

## Steps

### 1. Collect context

```
gh pr view <PR> --json number,title,body,headRefName,url
```

Find the linked issue from `Closes #N` in the body, then:

```
gh issue view <N> --json title,body
```

If the issue links a parent, read it for the decision record. Also read
`.claude/skills/architect/references/design-principles.md` — the qualities
there are the vocabulary for the design pass.

### 2. Bug pass (code-review on Fable)

The Skill tool cannot choose a model, so wrap it in an agent:

- Agent tool, `subagent_type`: `general-purpose`, `model`: `fable`
- Prompt: "Invoke the `code-review` skill with args `<PR> high`. Return the
  findings exactly as reported, with file and line for each."

Keep the returned findings; they are merged into the report.

### 3. Design pass

Read the diff:

```
gh pr diff <PR>
```

Compare it against the issue's 設計, To Implementer, and 実装が守る制約, and
against the PR's own Deviations section. Ask, concretely:

- Did it implement the chosen option, or something that resembles it?
- Did it make any decision the issue does not cover — a new interface, a
  new dependency, a changed data shape, a widened responsibility?
- Did it touch anything listed as out of scope?
- Do the tests cover the acceptance criteria, or only what was easy?
- Are the boundaries (DB, network, external services) still behind their
  seams?
- Anything in Deviations that the issue did not authorise?

### 4. Sort the findings

Two buckets. Getting this split right is the whole point of the skill.

**Code-level — fix without asking.** A bug, a missing or weak test, an
error path not handled as the issue specified, naming, dead code, an
inefficiency that does not change the design, and comments that should not
exist: ones that narrate what the code does, or refer to history ("was",
"previously", "per the issue"). Remove them. The developer wants these
handled, not reported.

**Design-level — do not fix, ask.** Anything that changes what was agreed:
a different option than the chosen one, a new decision the issue is silent
on, a changed interface or responsibility, a trade-off the developer did not
consent to, out-of-scope changes. Even if the agent's choice looks better,
the developer decides; the whole workflow exists so that this decision is
theirs.

When unsure which bucket, it is design-level.

### 5. Apply code-level fixes

If the implementer agent from this session is still available, continue it
with SendMessage: list the findings, ask it to fix, run tests, push. Otherwise
spawn a new agent (`model`: `opus`, `isolation`: `worktree`) told to check
out `headRefName` first. After the push, wait for CI once more as in the
implementer skill. Do not run a second full review round on your own; one
fix round, then report.

### 6. Report to the developer

Japanese, following `.claude/rules/writing.md`. Order:

1. One line: the PR, what it implements, whether CI passed.
2. Design-level findings, each with: what the issue said, what the code
   does, and the two choices — accept the deviation (issue gets updated) or
   revert to the design.
3. Code-level findings that were fixed, briefly.
4. Anything left open.

Then stop. Merging is the developer's action. If they accept a deviation,
offer to update the issue text so the record stays true.
