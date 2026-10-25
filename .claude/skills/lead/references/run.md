# Asking a run question

A `run` question is settled by building a throwaway and observing what it
does: what a function returns, how long a call takes, whether an outside
system accepts a given shape. The throwaway answers one question and is
thrown away; the fact and the question stay, in the round comment.

The agent that runs it observes and does not choose. Picking an option is
a design decision, made against the principles by whoever asked.

## 1. List what it calls

For a declared entry point, read its declaration instead of guessing at its
cost:

```
node .claude/scripts/entries.mjs show <entry> --env <main checkout>/.env
```

For anything else the throwaway would call, name the paid services and the
outside machines it reaches.

## 2. Ask before cost or an outside effect

If step 1 found a cost or an effect outside this machine, ask with
AskUserQuestion right before running it. Approval is for this one run, not
a standing yes. State what would run, its burdens in plain words, and two
options: run it, or do not. Write it following `.claude/rules/questions.md`,
starting from the design question the run answers.

Not approved: the answer is `could not run: 承認されませんでした`.

## 3. Spawn the agent

Agent tool, `subagent_type`: `general-purpose`, `model`: `sonnet`,
`isolation`: `worktree`. The brief holds the question, what to observe, and
pointers to the code involved, and says:

- Plan the smallest throwaway that makes the observation.
- Build it, run it, and commit or push nothing.
- Return `observed` (output, values, or timings, quoted as they came back),
  `ran` (the commands), and `could not run` with the error if it never
  produced an observation.
- Say nothing about which option is better.
- End with the worktree path and branch name.

## 4. Remove the worktree

The throwaway always leaves files, so the agent's own cleanup does not
fire. Remove it explicitly:

```
git worktree remove --force <path>
git branch -D <branch>
```

The branch holds no commits, so deleting it loses nothing.

Take `observed`, `ran`, and `could not run` as the agent reported them,
into the round's answers.
