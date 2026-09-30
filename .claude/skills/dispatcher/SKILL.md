---
name: dispatcher
description: "Work through the backlog of GitHub issues that are ready to build: pick the issues whose design is already decided, run the implementer and reviewer skills on them (in parallel when they are certainly independent), merge each PR when nothing is left for the developer, and move on. Use this whenever the developer wants several issues handled in a row without sitting on each one — 「できる issue を進めて」「次々やって」「issue を消化して」「順番に実装してマージして」「#111 の子を全部進めて」「まとめて進めて」「残りをやって」, or any phrasing that means 'keep going through the issues'. For a single named issue use implementer instead; for work that has no issue yet use architect."
---

# Dispatcher

## Why it works this way

architect turns a decision into small issues. implementer builds one and
reviewer checks it against the issue. Each of those stops and waits for the
developer at the end, which is right when the developer is watching one
issue. When they want the backlog worked through, the waiting is the cost.

dispatcher is the loop around those two skills. It picks the issues that
can be built, runs implementer (which chains into reviewer and, after that,
verifier), and then makes the one call the other skills leave to the
developer: merge, or leave the PR open. reviewer stays a reviewer; verifier
stays a verifier; the merge decision lives here. The rule for it is narrow
on purpose. Merge when the PR passed review and confirmation and nothing
in the run is waiting on the developer. Design changes the implementation
agent made, and choices listed under `Decided`, do not hold a merge; they
are reported so the developer can overturn them afterwards. Everything else
stays open, and the PR itself is the record of why. A PR
left open costs one look; a wrongly merged one costs a revert plus whatever
was built on top of it.

A verifier result of unverifiable means some check never actually ran — a
missing declaration, a missing key, or something only a person could judge.
That tells us nothing about whether the change works, so it blocks the
merge the same way a failing result does; treating it as a pass would let a
PR merge on the strength of a check nobody performed. Any approval a
checked entry point needs is asked by verifier itself, at the moment it
runs, wherever in the chain that is — dispatcher does not collect approvals
on verifier's behalf ahead of time.

Issues run in parallel only when they certainly cannot touch each other.
Every merge changes main, and a PR built on the old main can pass its own
checks and still break after the merge before it. When the file sets are
disjoint that cannot happen, so those issues go together. When there is any
doubt, they go one after another. Slower and safe beats fast and sorry.

GitHub is the record of what is ready, and this loop owns everything that
depends on its current state: which issues are ready, their order, which run
side by side, and the last look before a merge. The loop reads the open
issues once per pass. Contradictions between issues are settled when the
issues are created, so it does not check them. Before a merge it checks one
thing: that the issue has not been edited or commented on since work began.

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
implementer plus a two-model review with its own subagents, so a long run is
expensive in transcripts; that is the developer's call, not a reason to
stop on your own.

The caller may also hand over PRs that already went through implementer's
chain in this session — `architect` and `triager` do, for work with no
issue. For each, the caller passes what step 3 gathers: the PR number, the
Design changes section, reviewer's report, CI, and the verifier result.
Decide each with step 4 before step 1, so the queue is read from the merged
state. A PR with no issue has no last-updated time to compare, and step 4
skips that check for it.

## Step 1: Find the ready issues

List open issues once per pass. Run this every time this step starts;
nothing from an earlier listing is reused, because merges and edits made
during the run change what is ready.

```
gh issue list --state open --limit 200 --json number,title,body,updatedAt
```

A candidate is an issue where all of these hold. Check them by reading the
body; they are structural, not keyword matches.

- The body has a `## To Implementer` section. Without it, the issue did not
  come through architect. Leave it alone; it is not work to build.
- It is not a parent. A parent has a `## Child issues` list; it holds the
  shared design, not work.
- No open PR already closes it. A PR that is still open after a run is the
  developer's to look at, and the reason is on the PR. Check with:

  ```
  gh pr list --state open --json number,body --jq '.[] | select(.body | test("Closes #<N>\\b")) | .number'
  ```

A child of a parent is ready only when every child listed before it in the
parent's `## Child issues` list is closed as completed. The lists come from
the parents in the same listing. The closed predecessors' reasons come
from one more read in the same pass:

```
gh issue list --state closed --limit 500 --json number,stateReason
```

A predecessor that is still open means the child is not ready this pass.
Leave it out of the queue without adding it to the not-started list, since
a merge later in this run may finish the predecessor. A predecessor closed
as not planned means the child does not start: add it to the not-started
list with the predecessor's number.

No other dependency is checked. A child's `Parent:` line is not compared
with the lists: an open issue is work to build, and a child dropped from
every parent's list is closed by architect when it redoes the design.

**Not started.** Keep a per-run list of issues that did not start: number
and the reason. An issue lands on it here, when a predecessor was closed as
not planned, or in step 3, when implementer stops before spawning an agent.
An issue on the list is not tried again in this run. The list is a record
of what this run did, not a copy of GitHub, so it starts empty at the top
of the run and is not carried into the next one.

## Step 2: Order and group the ready issues

Two questions decide the order: which issues touch everything, and which
issues can be built at the same time. Both come from reading the ready
issues' `To Implementer` sections, in particular `Files / modules` and
`Out of scope`. Do this reading before
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

- They have different parents, or no parent. The children of one parent
  always run one at a time, in their listed order, whatever the parent's
  wording says.
- Their `Files / modules` lists name no common file, and neither lists a
  file the other's `Out of scope` protects.
- They do not both add to the same index or barrel file, the same README
  table, the same test snapshot set, or the same config file. Disjoint
  source files with a shared `index.ts` still conflict.

Dependencies between issues of different parents are not checked; only
file overlap is. "Certain" means it follows from what the issues say. If
deciding takes an argument, the answer is no, and the issues go in separate
batches, in issue number order. A batch has no size limit; how many agents
run at once is left to Claude Code.

Show the plan to the developer in one short list: the repo-wide issues in
order, then each batch with its issues and one line on why they are
independent. Then go; do not wait for confirmation, since they asked for
the loop.

## Step 3: Run a batch

Invoke the `implementer` skill for each issue in the batch. Spawn all of
the batch's implementer agents in one message, so they run at the same
time, each in its own worktree branched from the current main. Then wait.

As each issue's implementer run reports back, carry on with the rest of
implementer for that issue (CI wait, then `reviewer`, then `verifier`) only
when a PR was opened, one issue at a time, so that each merge lands before
the next review starts. Do not shortcut either skill or do their work
inline; the point of this loop is that each issue gets the same treatment
it would get alone.

Running implementer on an issue ends one of three ways:

- A PR was opened. Continue with CI, reviewer, and verifier, and gather
  below.
- implementer stopped on a question the developer declined to answer. A PR
  stays open if there was one. Quote the question in the report (step 5).
- implementer stopped before spawning an agent (step 1 of the implementer
  skill): the body had no `To Implementer` section. There is no PR; add the
  issue's number and that reason to the not-started list from step 1, and
  continue with the rest of the batch.

When implementer's chain for an issue — reviewer, then verifier — is in,
gather from the run:

- The PR number, the `updatedAt` implementer handed back, and the
  `Decided` and `Design changes` sections of the PR body.
- reviewer's report: what was fixed, what was dismissed, and any harm the
  developer declined.
- Whether CI ran, and its final result.
- The verifier result implementer's step 6 reported — pass, fail,
  not-needed, or unverifiable — and its reason.

Then decide for that PR (step 4) before reviewing the next one in the
batch, so the merged state is what the following review sees.

## Step 4: Merge or leave open

Merge only when every line below is true. One false line means the PR
stays open. When something does not fit either way cleanly, leave it open;
that is the cheap mistake.

- implementer opened a PR, and nothing in its run is waiting on the
  developer.
- reviewer left no harm finding open, and every `fix` finding was pushed.
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
  gh pr view <PR> --json mergeable,mergeStateStatus,headRefOid
  ```

  `BEHIND` is fine for a PR in a batch; disjointness was checked in step 2.
  `CONFLICTING` or `DIRTY` is not: the independence call was wrong. Leave
  the PR open and say so in the report. `headRefOid` from this same call is
  the commit to read the verifier status from below.
- For a PR built from an issue, the issue has not changed since work
  began. Run this last, immediately before the verifier status read and
  the merge commands below, not earlier while the other conditions were
  still being checked — review can take time, and the issue can change in
  that gap:

  ```
  gh issue view <N> --json updatedAt --jq .updatedAt
  ```

  Compare it with the `updatedAt` noted in step 3. Any difference leaves
  the PR open, and the report names the issue and both times. Only the
  issue's own time counts; edits to its parent do not stop the merge. A
  failed read also leaves the PR open, with gh's first error line. A PR
  with no issue skips this condition.
- The head commit's verifier status is success:

  ```
  gh api "repos/{owner}/{repo}/commits/<headRefOid>/status" --jq '.statuses[] | select(.context=="verifier") | .state'
  ```

  A missing status is not success. Run this immediately before merging too,
  for the same reason: a push can land on the PR while review was still
  running.

**Merge.** Follow this whenever a PR built by implementer is merged,
including when the developer asks for the merge in chat. Remove the agent's
worktree first, or the branch deletion fails because the branch is still
checked out there:

```
git worktree list --porcelain      # find the path whose branch is issue-<N>-…
git worktree remove --force <path>
gh pr merge <PR> --merge --delete-branch
git pull --ff-only origin main
git worktree prune
git branch -d worktree-agent-<id>  # <id> from the path, .claude/worktrees/agent-<id>
```

The Agent tool creates a `worktree-agent-<id>` branch with each worktree,
and the agent works on the issue branch it cuts from there. That first
branch holds nothing once the PR is merged, so it goes too. `-d` refuses a
branch holding commits main does not have; when it refuses, leave the
branch and name it in the report.

Merge commits, not squash: that is how every PR on main was merged so far,
and the log reads as one line per issue. `--delete-branch` removes the
remote and local branches; the repo does not delete branches on merge by
itself. The pull is what makes the next worktree start from the merged
state.

When the PR's `Design changes` is not `none` and the PR closed an issue,
leave the same text on that issue now, after the merge:

```
gh issue comment <N> --body "<Design changes, and the PR number>"
```

It goes after the merge because a comment moves the issue's last-updated
time, and a comment of our own would stop the merge.

**Leave open.** Do nothing to the PR or the worktree. The developer may
continue the agent, and reviewer's comments on the PR already say what
is left. No extra comment is needed. On the next run the open PR
keeps the issue out of the queue (step 1).

Two cases end with no PR: a question the developer declined, and an issue
that did not start (step 1 or step 3). Neither is recorded on GitHub, so
both appear only in the report, and the issue will look ready again on the
next run. Say this in the report so the developer edits the issue, or
repairs whatever the reason pointed at, before running dispatcher again.

An open PR does not stop the loop. Issues after it in the same parent's
order drop out of the queue on their own; everything else continues.

After the whole batch is decided, go back to step 1 with the same scope.
Re-read the queue rather than reusing the plan: merges and open PRs have
changed what is ready.

**Close finished parents.** When a parent's `Child issues` list is entirely
closed and no PR for any child is left open, close the parent too, with
one comment listing each child and the PR that closed it:

```
gh issue close <parent> --comment "$(printf '子 issue がすべて閉じました。\n\n- #<child> → PR #<pr>\n...')"
```

The parent holds the shared design; closing it does not change that,
the record stays readable. Do this whenever a merge completes a parent,
not only at the end, so the queue reads true while the loop runs. Do not
close a parent whose children are only partly done, or one that is a
方針 issue with no `Child issues` list.

## Stop conditions

Stop the whole loop, report what was done, and say why, when:

- The queue is empty, or the number the developer named is reached. The
  queue also counts as empty when every remaining ready issue is on the
  not-started list from step 1.
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
2. Merged: issue number, PR number, whether verifier's result was pass or
   not-needed, one line each.
3. Choices the developer may overturn: every `Decided` item and every
   `Design changes` entry of the merged PRs, and the findings reviewer
   dismissed, one line each with the PR number.
4. Left open: issue number, PR number if any, the reason in a few words —
   when the reason is verifier, say fail or unverifiable and its reason.
   Point at the PR comments rather than repeating them. A question with no
   PR is quoted here in full.
5. Not started: each issue on the not-started list, the reason, and what
   the developer needs to repair — usually the predecessor closed as not
   planned, or the parent's `Child issues` list.
   Keep these separate from item 4; there is no PR to point at.
6. Parents closed during the run, and what is ready next if anything
   remains.

Nothing in the report is asked. Then stop. If the developer wants a choice
from item 3 changed, that is new work: take it through `architect`, then
run dispatcher again. Do not implement it straight from the chat.
