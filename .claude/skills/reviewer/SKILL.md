---
name: reviewer
description: "Review a pull request against the design agreed in its GitHub issue. Use after the implementer skill opens a PR, and whenever the developer asks to review a PR — \"PR #14 をレビューして\", \"review the PR\", a PR URL, \"check what the agent built\". Runs the code-review skill on an Opus agent for bugs, then checks the diff against the issue's design and constraints. Posts every finding as an inline comment on the PR. Fixes code-level findings on its own; brings design-level findings to the developer instead of deciding."
---

# Reviewer

## Why two passes

The code-review skill finds bugs and cleanups. It does not know what was
agreed, so it cannot tell that the implementation quietly took the convenient
option instead of the chosen one. That drift is the thing the developer most
wants caught, so it gets its own pass, checked against the issue.

## Why the target is a URL

The code-review skill accepts a PR number, but its own instructions tell the
model to diff the working tree first and only then mention arguments. A bare
number is easy to lose at that point, and when the main checkout has
uncommitted edits, the skill reviews those instead of the PR and nobody
notices until the run ends. A full PR URL is impossible to misread, and it
carries the owner, repo, and number that inline commenting needs. Always pass
the URL, and always check afterwards that the review looked at the PR's files.

## Steps

### 1. Collect context

```
gh pr view <PR> --json number,title,body,url,headRefName,headRefOid,files,additions,deletions
```

Keep `url`, `headRefOid`, and the file list; the later steps need them. Find
the linked issue from `Closes #N` in the body, then:

```
gh issue view <N> --json title,body
```

If the issue links a parent, read it for the decision record. Also read
`.claude/skills/architect/references/design-principles.md` — the qualities
there are the vocabulary for the design pass.

Run `git status --short` in the main checkout. Do not stash or commit
anything; just remember whether tracked files are modified. If the scope
check in step 2 fails, this is the first suspect and belongs in the report.

### 2. Bug pass (code-review on Opus)

Pick the effort level. Higher levels report more, and the extra findings
are mostly nits the developer does not want on the PR, so start low and go
up only where bugs can actually hide:

- `medium` — default.
- `low` — scaffold or config-only PRs, docs, or diffs under roughly 150
  lines excluding lockfiles.
- `high` — only when the diff touches concurrency, auth, money, data
  migration, or another place where a missed bug is expensive.

The Skill tool cannot choose a model, so wrap it in an agent:

- Agent tool, `subagent_type`: `general-purpose`, `model`: `opus`
- Prompt, filled in with the real values:

> Invoke the `code-review` skill with args `--comment <level> <PR URL>`.
> The target is that PR, not the working tree of this checkout. Do not use
> the advisor tool at any point: decide the review axes yourself from the
> diff and the PR description, and run the review directly. Nesting another
> model under this one only adds latency. When the findings arrive, compare
> the files they name and the scope the skill reports against this list of
> PR files: `<file list>`. If the review covered anything else, do not
> rerun; report the mismatch and what the skill said its scope was.
> Otherwise return the findings exactly as reported, with file and line for
> each, and confirm that the inline comments were posted.
>
> Keep at most 5 subagents in flight at any moment. This covers every
> Agent call the skill asks for: the finder angles in phase 1 and the
> one-per-candidate verifiers in phase 2. Launch them in groups of no more
> than 5 per message, wait for the whole group to return, then launch the
> next group. Never launch all finders or all verifiers in one message.

The skill launches its finders and verifiers as subagents and says nothing
about how many at once, so the model's default is all of them in one
message: 8 finders, then one verifier per candidate, nested two levels
below this session. Runs of 10 to 14 concurrent agents have frozen the
session, so the prompt caps the group size. The skill runs in a fork that
inherits the wrapper's context, which is why the cap can live in this
prompt. If the freeze persists, the next step is `model`: `sonnet` on the
skill's subagents, or a custom agent definition without the Agent tool,
which makes the skill run every angle inline with no subagents at all.

Keep `--comment` at the start or the end of the args; the skill only
recognises the flag at either end. With it, the skill posts each of its
findings as an inline comment on the PR, so the bug pass needs no separate
posting step.

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

### 5. Post the design-pass findings on the PR

The developer reads findings where the code is, not in a chat log. The bug
pass already posted its own; post every finding from step 3 the same way,
before anything is fixed, so each comment anchors to the commit that was
reviewed.

Prefix the body with `[design]` or `[code]` so the buckets are visible on
the PR. For a finding that points at a line:

```
gh api repos/<owner>/<repo>/pulls/<PR>/comments \
  -f commit_id=<headRefOid> -f path=<file> -F line=<line> -f side=RIGHT \
  -f body='[design] ...'
```

For a finding with no single line (wrong option chosen, scope widened,
missing test file), one PR-level comment:

```
gh pr comment <PR> --body '[design] ...'
```

Write the comment bodies in Japanese, following `.claude/rules/writing.md`.
A design-level comment states what the issue said, what the code does, and
that the developer decides.

### 6. Apply code-level fixes

If the implementer agent from this session is still available, continue it
with SendMessage: list the findings, ask it to fix, run tests, push. Otherwise
spawn a new agent (`model`: `sonnet`, `isolation`: `worktree`) told to check
out `headRefName` first. After the push, wait for CI once more as in the
implementer skill. Do not run a second full review round on your own; one
fix round, then report.

After the push, close the loop on the PR. List the review comments, and
reply on each thread whose finding was fixed with the commit that fixed it:

```
gh api repos/<owner>/<repo>/pulls/<PR>/comments --jq '.[] | {id, path, line, body}'
gh api repos/<owner>/<repo>/pulls/<PR>/comments/<id>/replies -f body='<sha> で修正しました。'
```

Design-level threads stay open; they are the developer's to answer.

### 7. Report to the developer

Japanese, following `.claude/rules/writing.md`. Order:

1. One line: the PR, what it implements, whether CI passed, and that the
   findings are on the PR as comments.
2. Design-level findings, each with: what the issue said, what the code
   does, and the two choices — accept the deviation (issue gets updated) or
   revert to the design.
3. Code-level findings that were fixed, briefly.
4. Anything left open, including a scope-check failure from step 2 and the
   modified files noticed in step 1 if there were any.

Then stop. Merging is the developer's action. If they accept a deviation,
offer to update the issue text so the record stays true.
