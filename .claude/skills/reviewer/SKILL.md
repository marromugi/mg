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

If the issue links a parent, read it for the decision record and the shared
constraints. Also read `software-design-theory` — its principles and its
Tests section are the yardstick for the design pass.

Get the order of the commits as well; the design pass needs it:

```
gh pr view <PR> --json commits --jq '.commits[] | "\(.oid[0:7]) \(.messageHeadline)"'
```

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

Compare it against the issue's 設計, 制約, ケース, and To Implementer, and
against the PR's own Cases and Deviations sections. Ask, concretely:

**The design**

- Did it implement the decided design, or something that resembles it?
- Did it make any decision the issue does not cover — a new interface, a
  new dependency, a changed data shape, a widened responsibility?
- Did it touch anything listed as out of scope?
- Does every 構造 constraint hold? Run the issue's structural checks against
  the PR branch rather than trusting the PR body.
- Does every 向き constraint hold in the code as written?
- Are outside specifications still behind their interface (principle 7)?
- Anything in Deviations that the issue did not authorise?

**The tests**

- Does every case in the issue have a row in the PR's Cases table, and does
  the named test exist?
- Does each test assert what its case says is seen, with the case's literal
  values? A test that shares a case's name but asserts something weaker does
  not receive it.
- Is any test hollow by the theory's Hollow tests list? Read the assertions,
  not the titles.
- Is there a test no case calls for? It is either a missing case, which is
  design-level, or padding, which is code-level.
- Did the tests come before the implementation? The commit that adds the
  tests precedes the commit that adds the behaviour. A single commit holding
  both is a finding.

### 4. Sort the findings

Two buckets. Getting this split right is the whole point of the skill.

**Code-level — fix without asking.** A bug, a case with no test, a test
weaker than its case, a hollow or padding test, tests committed together with
or after the implementation, an error path not handled as the issue
specified, naming, dead code, an inefficiency that does not change the
design, and comments that should not exist: ones that narrate what the code
does, or refer to history ("was", "previously", "per the issue"). Remove
them. The developer wants these handled, not reported.

A departure from the issue that the agent did not argue for is also
code-level: a broken 構造 or 向き constraint, an out-of-scope change, a
different shape than the decided one. The design was already judged; the fix
is to bring the code back to it.

**Design-level — do not fix, ask.** Anything that reopens the design: the
agent reports, in Deviations or in its final message, that the design as
written cannot work; the code needs a decision the issue is silent on; a
behaviour needs a case the issue does not have; an interface or a
responsibility has to change. Even if the agent's choice looks better, it is
not the reviewer's to accept. Check it against `software-design-theory`: if a
principle settles it, say which and treat the finding as code-level. If none
does, it goes to the developer.

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

After the report, put the choice for each design-level finding as a
question, in the form `architect` step 4 gives: the AskUserQuestion tool, one
entry per finding.

Then stop. Merging is the developer's action. If they accept a deviation,
offer to update the issue text so the record stays true.
