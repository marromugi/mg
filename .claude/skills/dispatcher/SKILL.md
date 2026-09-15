---
name: dispatcher
description: "Work through the backlog of GitHub issues that are ready to build: pick the issues whose design is already decided, run the implementer and reviewer skills on them (in parallel when they are certainly independent), merge each PR when nothing needs a design call from the developer, and move on. Use this whenever the developer wants several issues handled in a row without sitting on each one — 「できる issue を進めて」「次々やって」「issue を消化して」「順番に実装してマージして」「#111 の子を全部進めて」「まとめて進めて」「残りをやって」, or any phrasing that means 'keep going through the issues'. For a single named issue use implementer instead; for work that has no issue yet use architect."
---

# Dispatcher

## Why it works this way

architect turns a decision into small issues. implementer builds one and
reviewer checks it against the issue. Each of those stops and waits for the
developer at the end, which is right when the developer is watching one
issue. When they want the backlog worked through, the waiting is the cost.

dispatcher is the loop around those two skills. It picks the issues that
can be built, runs implementer (which chains into reviewer), and then makes
the one call the other skills leave to the developer: merge, or leave the
PR open. reviewer stays a reviewer; the merge decision lives here. The rule
for it is narrow on purpose. Merge only when nothing in the run asked for a
decision. Everything else stays open, and the PR itself is the record of
why. A PR left open costs one look; a wrongly merged one costs a revert
plus whatever was built on top of it.

Issues run in parallel only when they certainly cannot touch each other.
Every merge changes main, and a PR built on the old main can pass its own
checks and still break after the merge before it. When the file sets are
disjoint that cannot happen, so those issues go together. When there is any
doubt, they go one after another. Slower and safe beats fast and sorry.

## Before starting

Run these in the main checkout and stop if any fails:

```
git status --short        # must print nothing outside .claude/worktrees
git branch --show-current # must be main
git pull --ff-only origin main
```

The developer's checkout is where each implementer worktree branches from,
and where the loop pulls after every merge. Working on a dirty or stale
checkout would either lose their edits or build the next issue on the wrong
base. If the check fails, say which one and stop; do not stash or reset.

Then settle the scope. The developer may have said a parent issue (「#111 の
子」), a list of numbers, or nothing. With nothing, the queue is every ready
issue. There is no cap by default: the loop runs until the queue is empty,
including issues that become ready because of merges made during the run.
The developer can name a number to stop earlier. Each issue runs a Sonnet
implementer plus an Opus review with its own subagents, so a long run is
expensive in transcripts; that is the developer's call, not a reason to
stop on your own.

## Step 1: Find the ready issues

List open issues:

```
gh issue list --state open --limit 100 --json number,title,body
```

An issue is ready when all of these hold. Check them by reading the body;
they are structural, not keyword matches.

- The body has a `## To Implementer` section. Without it, the issue did not
  come through architect. Leave it alone; it is not work to build.
- It is not a parent. A parent has a `## 決定` section and a `## 子 issue`
  list; it holds the record, not work.
- No open PR already closes it. A PR that is still open after a run is the
  developer's to look at, and the reason is on the PR. Check with:

  ```
  gh pr list --state open --json number,body --jq '.[] | select(.body | test("Closes #<N>\\b")) | .number'
  ```

- Its predecessors are merged. If 設計 links a parent, read the parent's
  `## 子 issue` list. Every child listed before this one must be closed,
  unless the parent says in words that this child is independent of the
  others (「他と独立です」 or similar). When the parent's wording is unclear,
  treat the list as strict order.

## Step 2: Order and group the ready issues

Two questions decide the order: which issues touch everything, and which
issues can be built at the same time. Both come from reading the ready
issues' `To Implementer` sections, in particular `Files / modules` and
`Out of scope`, and the parents' `子 issue` lists. Do this reading before
starting anything, over the whole ready set, so a later issue cannot
surprise an earlier one.

**Repo-wide issues go first, each alone.** An issue is repo-wide when what
it changes is felt by every package or by every later PR: CI, git hooks,
the Node or pnpm version, root `package.json`, lockfile, lint or format
config, `tsconfig.base.json`, workspace layout, the shared skill files.
These come first regardless of issue number or age, because every PR
merged after them gets their checks or their settings, and every PR merged
before them has to be re-checked. Run a repo-wide issue on its own; nothing
else is in flight while it builds, reviews, and merges.

**Everything else goes in batches of independent issues.** Two issues can
share a batch only when all of these are certain:

- Neither is before the other in a parent's `子 issue` order, or the parent
  says they are independent.
- Their `Files / modules` lists name no common file, and neither lists a
  file the other's `Out of scope` protects.
- They do not both add to the same index or barrel file, the same README
  table, the same test snapshot set, or the same config file. Disjoint
  source files with a shared `index.ts` still conflict.
- Neither depends on a package export the other creates. An issue in
  `tools` that uses a type an issue in `core` adds is dependent even if the
  files are disjoint.

"Certain" means it follows from what the issues say. If deciding takes an
argument, the answer is no, and the issues go in separate batches, in issue
number order within their parent order. Keep a batch to at most 3 issues:
each one is an agent in this session, and reviews are run one at a time
afterwards anyway.

Show the plan to the developer in one short list: the repo-wide issues in
order, then each batch with its issues and one line on why they are
independent. Then go; do not wait for confirmation, since they asked for
the loop.

## Step 3: Run a batch

Invoke the `implementer` skill for each issue in the batch. Spawn all of
the batch's implementer agents in one message, so they run at the same
time, each in its own worktree branched from the current main. Then wait.

As each agent reports, carry on with the rest of implementer for that issue
(CI wait, then `reviewer`), one issue at a time, so that each merge lands
before the next review starts. Do not shortcut either skill or
do their work inline; the point of this loop is that each issue gets the
same treatment it would get alone.

When reviewer's report for an issue is in, gather from the run:

- Did implementer stop on a design question instead of opening a PR?
- The PR number and the Deviations section.
- reviewer's design-level findings (the `[design]` ones), and whether the
  code-level fixes were pushed.
- Findings, from either pass, that ask for something the issue or its
  parent already decided against: a different return shape than the
  issue's interface, a fallback the issue prescribed, a trade-off listed
  under 承知の上で手放したもの. These are not defects in the PR. Reply on
  the thread with the issue or parent section that decides it, do not fix,
  and keep them for the report as questions the developer may reopen.
- Whether CI ran, and its final result.

Then decide for that PR (step 4) before reviewing the next one in the
batch, so the merged state is what the following review sees.

## Step 4: Merge or leave open

Merge only when every line below is true. One false line means the PR
stays open. When something does not fit either way cleanly, leave it open;
that is the cheap mistake.

- implementer opened a PR (it did not stop on a design question).
- Deviations is `none`, or every deviation listed is a mechanics detail
  that the issue's own constraints or the tooling forced (a config key the
  tool spells differently, a lint rule that rejects the issue's literal
  snippet, a cast the type definitions need) and that changes no
  interface, dependency, scope, or behaviour the issue specifies. Say in
  the report which deviations you read that way. A deviation that picks
  an option, adds or drops a dependency, widens scope, or changes what the
  developer would see is a design change, and the PR stays open.
- reviewer posted zero design-level findings that need the developer.
  A finding answered on its thread with the issue section that already
  decides it (step 3) does not count; a finding that the issue is silent
  on does.
- Every code-level finding is fixed and pushed, or there were none.
- The final head is verified. If the repo has CI checks, they are green on
  that head. If `gh pr checks` reports no checks configured, run the checks
  yourself in the PR's worktree, in this order, and all must pass:

  ```
  pnpm install --frozen-lockfile && pnpm build && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
  ```

  Without CI, the only evidence of a green build is the agent's own word.
  That is not enough to merge on.
- The PR is mergeable:

  ```
  gh pr view <PR> --json mergeable,mergeStateStatus
  ```

  `BEHIND` is fine for a PR in a batch; disjointness was checked in step 2.
  `CONFLICTING` or `DIRTY` is not: the independence call was wrong. Leave
  the PR open and say so in the report.

**Merge.** Remove the agent's worktree first, or the branch deletion fails
because the branch is still checked out there:

```
git worktree list --porcelain      # find the path whose branch is issue-<N>-…
git worktree remove --force <path>
gh pr merge <PR> --merge --delete-branch
git pull --ff-only origin main
git worktree prune
```

Merge commits, not squash: that is how every PR on main was merged so far,
and the log reads as one line per issue. `--delete-branch` removes the
remote and local branches; the repo does not delete branches on merge by
itself. The pull is what makes the next worktree start from the merged
state.

**Leave open.** Do nothing to the PR or the worktree. The developer may
continue the agent, and reviewer's comments on the PR already say what
needs deciding. No extra comment is needed. On the next run the open PR
keeps the issue out of the queue (step 1).

The one case with no PR is a design question from implementer. There is
nothing on GitHub to record it, so it appears only in the report, and the
issue will look ready again on the next run. Say this in the report so the
developer edits the issue before running dispatcher again.

An open PR does not stop the loop. Issues after it in the same parent's
order drop out of the queue on their own; everything else continues.

After the whole batch is decided, go back to step 1 with the same scope.
Re-read the queue rather than reusing the plan: merges and open PRs have
changed what is ready.

**Close finished parents.** When a parent's `子 issue` list is entirely
closed and no PR for any child is left open, close the parent too, with
one comment listing each child and the PR that closed it:

```
gh issue close <parent> --comment "$(printf '子 issue がすべて閉じました。\n\n- #<child> → PR #<pr>\n...')"
```

The parent holds the decision record; closing it does not change that,
the record stays readable. Do this whenever a merge completes a parent,
not only at the end, so the queue reads true while the loop runs. Do not
close a parent whose children are only partly done, or one that is a
方針 issue with no `子 issue` list.

## Stop conditions

Stop the whole loop, report what was done, and say why, when:

- The queue is empty, or the number the developer named is reached.
- A merge fails, or `git pull --ff-only` fails. Something changed under the
  loop; the developer needs to look before anything else is built on it.
- The main checkout is no longer clean on main.
- A run ends in a state the steps above do not describe: reviewer could not
  find the PR's files, an agent stopped without a report, a tool froze.
  Do not retry into the unknown; describe it and stop.

## Step 5: Report

Japanese, following `.claude/rules/writing.md`. Order:

1. One line: how many merged, how many left open, and why the loop stopped
   (queue empty, the developer's number, or a stop condition).
2. Merged: issue number, PR number, one line each. Name any deviation you
   read as mechanics (step 4) so the developer can disagree.
3. Left open: issue number, PR number if any, the reason in a few words,
   and what the developer decides. Point at the PR comments rather than
   repeating them. A design question with no PR is quoted here in full.
4. Questions the developer may reopen: the findings answered on their
   threads because the issue already decided them (step 3), one line each
   with the PR number. These merged; they are listed so the developer can
   change the design if the reviewer had a point.
5. Parents closed during the run, and what is ready next if anything
   remains.

Then stop. If the developer answers the questions in item 4, those answers
are new design decisions with no issue yet: take them through `architect`,
which records them and creates the issues, and then run dispatcher again.
Do not implement an answer straight from the chat.
