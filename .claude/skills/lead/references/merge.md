# Merging a step

Every PR that implementer opened for a goal is merged or left open here.
When something does not fit either way cleanly, leave it open; that is the
cheap mistake. A PR left open costs one look; a wrongly merged one costs a
revert plus whatever was built on top of it.

## Merge only when every line holds

- implementer opened the PR, and nothing in its run is waiting on the
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

  `BEHIND` is fine when the steps in flight passed the independence test.
  `CONFLICTING` or `DIRTY` is not. `headRefOid` from this same call is the
  commit to read the verifier status from below.
- Nobody else changed the goal issue since lead last wrote to it. Lead
  keeps the issue's `updatedAt` right after each of its own writes. Run
  this last, immediately before the verifier status read and the merge:

  ```
  gh issue view <N> --json updatedAt --jq .updatedAt
  ```

  Any difference means the developer edited or commented. Leave the PR
  open, and read what they said in the next round. A failed read also
  leaves the PR open, with gh's first error line.
- The head commit's verifier status is success:

  ```
  gh api "repos/{owner}/{repo}/commits/<headRefOid>/status" --jq '.statuses[] | select(.context=="verifier") | .state'
  ```

  A missing status is not success. A result of unverifiable means some
  check never ran, so it blocks the merge the same way a fail does. Run
  this immediately before merging too: a push can land while review runs.

Design changes the implementation agent made, and choices under `Decided`,
do not hold a merge. They go in the round comment and the report, where the
developer can overturn them afterwards.

## Merge

Remove the agent's worktree first, or the branch deletion fails because
the branch is still checked out there:

```
git worktree list --porcelain      # find the path whose branch is the step's
git worktree remove --force <path>
gh pr merge <PR> --merge --delete-branch
git pull --ff-only origin main
git worktree prune
git branch -d worktree-agent-<id>  # <id> from the path, .claude/worktrees/agent-<id>
```

The Agent tool creates a `worktree-agent-<id>` branch with each worktree,
and the agent works on a branch it cuts from there. That first branch holds
nothing once the PR is merged, so it goes too. `-d` refuses a branch
holding commits main does not have; when it refuses, leave the branch and
name it in the report.

Merge commits, not squash, so the log reads as one line per step.
`--delete-branch` removes the remote and local branches; the repo does not
delete branches on merge by itself. The pull makes the next worktree start
from the merged state.

## Leave open

Do nothing to the PR or the worktree. reviewer's comments on the PR already
say what is left. The next round reads them.
