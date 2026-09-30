---
name: software-design-theory
description: "The yardstick for every design judgment in this repo: the principles a design follows, which calls the maker decides alone and which go to the developer, what tests are for and how to spot one that guards nothing, and how a pull request is reviewed. Other skills read this instead of holding their own copy — architect when it shapes a design, implementer when it builds and when it changes a design on the way, reviewer when it judges a PR and its tests. Use it whenever a design is being proposed, compared, or defended, and whenever someone asks whether a test earns its place."
---

# Software design theory

This is the written form of the developer's design intent. The maker of a
design follows it, and whoever reviews a pull request judges against it.

The work runs as a fast loop: build, run what was built, find what is
wrong, fix it. Judgment is spent on the running result, not on the design
before any code exists.

## How to use this

- Whoever makes a design follows the principles and decides the calls they
  leave open. Names, values, formats, and how a small defect is handled are
  the maker's. The maker lists them in the issue's `Decided` section, or in
  the PR body when there is no issue, where the developer can overturn them.
- A question that running something can answer is settled by running it.
- Only what the section "What goes to the developer" names is asked.
  Everything else proceeds, and the result is shown afterwards.
- This file is a general theory of software design. An answer enters it
  only when it states a rule that would hold in any codebase, and then as
  the wording of the principle it belongs to. An answer about one product —
  a name, a value, a wording, the shape of one entry point — lives in the
  issue or PR of the work that asked.

## Principles

### 1. Design from the whole

- Start from the picture of the whole software: the roles in it and how they
  relate.
- Decide where the piece at hand stands in that picture.
- Cut the interfaces the picture calls for, before any implementation needs
  them. An interface is the types and promises visible from outside a piece.
- Cutting an interface is setting the skeleton of the software. It is a design
  decision derived from the picture, not a forecast of what may come. If it
  can only be argued from what might be needed later, the picture is not
  finished; go back to the picture.
- Put concrete implementations on the interfaces last.
- An interface comes from a role in the picture, not from the
  implementations that exist today. That holds for whether it exists — one
  implementation is a normal state — and for what it takes and gives back.
  The role's one sentence (2) sets those; what the first implementation
  happens to need, such as text because the first condition reads text, is
  that implementation's own.
- Shared parts come from roles, not from resemblance. Code that looks alike is
  not a reason to merge it.
- Providing parts to other pieces is a role. When a second piece comes to use
  parts that live inside a piece with another role, the parts move to a piece
  whose role is to provide them. The first piece does not publish them on the
  side.
- The same holds for types and errors. Two concepts do not share a type
  because their contents happen to match today. Each concept has its own
  types, and its own errors.
- Two concepts may state the same condition in the same words. Each keeps its
  own copy of the text; matching wording is neither sharing nor a reason to
  reword one of them.
- One concept is recorded one way wherever it occurs. When a piece starts
  another instance of what it is itself — a conversation that starts a
  conversation — the started one is stored as its own record, in the same form
  as the starter's, and the starter holds a reference to it. It is not nested
  inside the starter's record.

### 2. One responsibility, verifiable alone

- A piece has one role that fits in one sentence.
- A piece can be verified without running the pieces around it.
- A piece carries out its role in full on what it is given. A rule about what
  to leave out — a directory not to enter, a target not to touch — is not part
  of doing the work. It belongs to the role that holds such rules. That other
  tools leave something out by habit is not a reason to build the habit into
  the piece.

### 3. Independent and injectable

- A piece receives what it uses from outside: collaborators, keys, the
  function that talks to the network.
- Dependencies point one way. A lower layer does not know the layers above it.
- A lower layer's types change when its own model of its subject changes, and
  then the change may be as large as it needs to be. They do not change so
  that a value an upper layer cares about can ride through.

### 4. No stopgaps

- When the right shape is known, the size of the change is not a reason
  against it.
- A small diff is not a reason to pick an option.
- Ease of backing out is not a reason to pick an option.
- When the right shape is not known, build the likeliest one, run it, and
  let what is seen decide. Friction that keeps coming back in the same
  form while building is the sign the shape is wrong; redraw it rather
  than patching around it.

### 5. Defined failure, no guessing

- What happens when a step fails is decided in the design.
- On ambiguity the software stops and says so. Ambiguity is anything it would
  have to guess to go on: a value it does not have, or input that can be read
  more than one way, such as two items sharing what should tell them apart.
  It does not pick a reading, fill a value with a guess, or write something
  it does not know to be true.
- What a piece cannot give back faithfully, it leaves out and says so. This
  holds even when a neighbouring piece shows the same thing in an approximate
  form; keeping the two alike does not outrank it.
- A record that others can change while the software works, such as an issue,
  is read again right before the software acts on it. A sign of change that
  the software cannot interpret, such as a new comment, stops the action. Its
  content is not interpreted.
- A failure shows the way the caller reads failure, and what counts as one
  follows from the piece's role. For a piece whose role is to judge — a
  check, a verification — a failed judgment is its failure, so it shows as
  one, such as a non-zero exit. A piece that only measures or computes has
  succeeded once it has done so, whatever the numbers say.
- When the software says that something failed or was left out, it says why,
  with enough detail for the reader to choose the next action. The reader is
  often an agent, and the reason is what it acts on.

### 6. Let machines hold the rules

- A promise that types can express is expressed in types.
- A promise that types cannot express is expressed as a check or a test.
- A promise that lives only in prose is the last resort.
- A safeguard is optional only where leaving it out harms nothing. Where a
  piece is handed the means to act on a machine, the safeguard that judges its
  actions is required by the type. A default does not stand in for it, neither
  "none" nor one inherited from somewhere else.
- The means are tools and connections to machines alike. A type cannot tell a
  tool that reads from one that writes, so any tool counts.
- A place that already hands out such means without the safeguard is brought
  into line as its own issue (9), not inside the work that found it.

### 7. Keep outside specifications behind an entrance and an exit

- What rests on no outside specification is ours to design, and is closed
  within our design.
- What rests on an outside specification — a vendor's API, a wire format, a
  service's behaviour — is held inside the implementation that speaks it. The
  interface is shared; each implementation is the entrance and the exit that
  keeps its own outside specification in.
- Implementations of different outside specifications are not shared just
  because the specifications look the same today. Likeness between them means
  something only when there is an agreement behind it.
- Before sharing code across outside specifications, find out what that
  agreement is: a published standard, a specification the parties commit to.
  Share with that evidence, to the extent the agreement covers. Without it, do
  not share.
- Where a widely agreed convention exists, follow it.
- A limit that comes from how one implementation works — what it can run at
  once, what it holds exclusively — is declared by that implementation through
  the shared interface, in our own words. Shared code reads the declaration.
  It does not carry a blanket rule sized to the most limited implementation.
- Everything that belongs to an outside specification lives inside its
  implementation: its defaults, such as a model name or a URL, and its
  vocabulary. Shared code holds none of it. A shared interface names its
  types and fields in our own words, and text that shared code shows to the
  user names no vendor.

### 8. No history in the code

- Code says what the design is now.
- A comment exists only for what the code cannot say.
- Test names and descriptions carry no history and no issue numbers.
- Documents that describe the code change in the same work as the code.


### 9. Every change in behaviour is named

- Behaviour is what the user of the software observes: default values, the
  text that comes back, pass or fail, the way a failure shows.
- Every change in behaviour is named where the work is recorded: the
  issue's `Request` or `Decided`, or the PR body when there is no issue.
- Behaviour that is not named stays as it is. Work does not improve things
  in passing.
- A defect found along the way that the work does not need fixed is left
  out of the work and becomes its own note issue.
- When building shows the design does not hold, the one building redraws
  it on the spot and names what changed and why in the PR body. After the
  merge, the same is left as a comment on the issue.
- For work that changes structure only, the existing tests passing
  unchanged is the evidence that it is correct.

## Tests

Tests keep the behaviour the developer asked for from breaking while the
code keeps changing. A test that guards nothing asked for is a cost, not a
safety: it slows every later change and says nothing when it passes.

### What gets a test

- The behaviour named in the request, checked the way its caller uses it.
- A fixed bug, with one test that reproduces it.
- Nothing else. The count of tests is not a measure of anything.

### How a test is written

- It calls the code the way its users do, and checks what they see.
- Expected values are literal.
- A piece that sits above an interface is tested by handing it a fake of
  that interface. Faking what lies beyond the interface, such as the
  network, is a sign the test has left the design.
- The implementation of an interface is the one place that fakes what lies
  beyond it.

### Tests that guard nothing

A test is deleted when any of these holds:

- It still passes when every function it calls returns nothing.
- It only checks that a fake was called.
- It checks the inside of the implementation, not what a caller sees.
- Another test already checks the same behaviour.
- It checks behaviour the request did not ask for.

### Confirmation on the running software

- Work that changes behaviour gets a confirmation on the running software,
  by an agent that did not write or review the code, before it lands.
- What to run and what counts as a pass is written with the design, in
  `Verification`. It is never worked out from the diff.
- Work that changes no behaviour gets no such confirmation; the existing
  tests are the evidence (9).
- Work whose behaviour no runnable entry reaches says why.
- Each entry an implementation can be run from declares how it runs and
  what it costs, next to itself (7).
- A confirmation that could not be done is not a pass.

## Pull request review

There is no review before code. Each PR gets one review, from two reviewers
who did not write it, on different models, given the same prompt. Model
diversity is the point; they are not split by lens. Two reviewers raising
the same finding is the strongest signal.

A reviewer reports only these kinds, each tied to a concrete scenario:

| Kind | What it is |
|---|---|
| mismatch | It does not do what the request asked |
| bug | A concrete input or state gives a wrong result or a crash |
| harm | It costs the developer money, cannot be undone, or reaches outside this machine unasked |
| test | A test that guards nothing, by the list above |

A reviewer does not report another way it would have built it, naming,
formatting, style, abstractions the code does not need yet, or anything it
cannot tie to a concrete scenario.

The maker triages every finding. It fixes what holds, and dismisses what
does not with a one-line reason: the scenario cannot happen, or the finding
is a preference. Dismissed findings stay on the PR, so the developer can
overturn them. Only harm goes to the developer.

## What goes to the developer

- What to build, when the request leaves it unclear in a way that changes
  the result.
- Anything that spends money: running the software, an experiment, or a
  check against a paid service. Asked right before it runs.
- Any action that cannot be undone.
- Any effect outside this machine that the request did not ask for.

What does not go:

- Names, values, formats, and wording. The maker decides and lists them.
- How a defect found in review is handled.
- A design change found while building. It is made and recorded (9).
- The order, batching, and pace of the work, and whether to merge work
  that passed review and confirmation.
- Anything the issue or PR of the work, or of its parent, already answers.
