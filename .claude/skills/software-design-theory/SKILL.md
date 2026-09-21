---
name: software-design-theory
description: "The yardstick for every design judgment in this repo: the principles a design must follow, what tests are for and how to spot a hollow one, the lenses a review is split into, and which questions still go to the developer. Other skills read this instead of holding their own copy — architect when it shapes a design, the design review when it judges one, implementer and reviewer when they write and check tests. Use it whenever a design is being proposed, compared, reviewed, or defended, and whenever someone asks whether a test earns its place."
---

# Software design theory

This is the written form of the developer's design intent. A design used to be
judged against what the developer had in mind, so the developer had to be the
judge. With the intent written down, an LLM can make the design and a different
LLM can judge it.

## How to use this

- Whoever makes a design follows the principles.
- Whoever reviews a design judges it against the principles, and cites the
  principle behind each finding.
- What the principles settle is not put to the developer.
- What the principles do not settle is put to the developer, as a question
  with options.
- This file is a general theory of software design. An answer enters it only
  when it states a rule that would hold in any codebase, and then as the
  wording of the principle it belongs to, so that question is not asked
  again. An answer about one product — a name, a value, a wording, the shape
  of one entry point — lives in the decision record of the work that asked.

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
- When the right shape is not known, make a proposal and put it through design
  review.

### 5. Defined failure, no guessing

- What happens when a step fails is decided in the design.
- On ambiguity the software stops and says so. It does not fill a value with a
  guess, and it does not write something it does not know to be true.
- What a piece cannot give back faithfully, it leaves out and says so. This
  holds even when a neighbouring piece shows the same thing in an approximate
  form; keeping the two alike does not outrank it.
- A record that others can change while the software works, such as an issue,
  is read again right before the software acts on it. A sign of change that
  the software cannot interpret, such as a new comment, stops the action. Its
  content is not interpreted.
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

### 9. Every change in behaviour is a named decision

- Behaviour is what the user of the software observes: default values, the
  text that comes back, pass or fail, the way a failure shows.
- Every change in behaviour is written in the decision record as a decision.
- Behaviour the record does not name stays as it is. A design does not
  improve things in passing.
- A defect found along the way that the work does not need fixed is left out
  of the work and becomes its own issue.
- Decisions are made when the design is made. A review finds what is wrong
  with a design; it does not add decisions to it.
- For work that changes structure only, the existing tests passing unchanged
  is the evidence that it is correct.

## Tests

Tests exist to keep the implementation from drifting away from the design.

### Three kinds of constraint

A design constrains the implementation in three ways, and each is held by a
different means. Write them apart.

| Kind | Example | Held by |
|---|---|---|
| Behaviour | Zero results is not an error; the tool returns a sentence saying so | A test |
| Structure | The package's dependencies stay core and zod | A mechanical check |
| Direction | The tool sees only the interface | A review lens |

- Every constraint has an id.
- Every behaviour constraint is received by at least one case.
- Every case names the ids it receives.
- An id with no receiver is found by a machine, not by rereading.
- Work that carries no implementation, such as cutting interfaces, has no
  behaviour constraints. Passing the type check shows it is consistent as
  design, and that is its verification.

### Cases

- A case is written from what the user of the piece sees.
- A case states its pass condition.
- Expected values are literal.
- Tests are committed before the implementation, and the implementation is
  committed on top. A reviewer confirms the order from the history.

### Hollow tests

- If the test still passes when every function it calls returns nothing, it
  guards nothing.
- A test that only asserts a fake was called is hollow.
- A test that mirrors the inside of the implementation is hollow.
- A piece that sits above an interface is tested by handing it a fake of that
  interface. Faking what lies beyond the interface, such as the network, is a
  sign the test has left the design.
- The implementation of an interface is the one place that fakes what lies
  beyond it.

## Review lenses

A review is split by lens, and each reviewer holds few lenses so that none is
skimmed. A reviewer is never the one who made the thing under review.

After the design is made:

| Reviewer | Lenses |
|---|---|
| Whole and position | The design starts from the picture of the whole and places the piece in it (1). Each interface takes and gives back what its role says, not what its first implementation needs (1). Dependencies point one way (3). |
| Fit with what exists | No design already in the repo contradicts this one. The design works on the real code and under the real outside constraints. Code shared across outside specifications has the agreement behind it named, and nothing of an outside specification — a default, a term — sits in shared code (7). |
| Right shape | The design is not a stopgap: it is what would have been built had the requirement been there from the start (4). Every failure is decided (5). No behaviour changes that the record does not name (9). |
| Calls that are not ours | Some decision in the design is a product or preference call that no principle settles. This reviewer looks only for those, and assumes there is at least one. |

After the cases are written:

| Reviewer | Lenses |
|---|---|
| Coverage and intent | Every behaviour constraint is received. Each case follows the intent of the design it guards. |
| Hollow tests | No case is hollow, and none is there only to add to the count. |

On the pull request, the reviewer skill repeats the two case lenses against the
test code, and confirms from the history that tests came before the
implementation.

## What still goes to the developer

- The goal and the scope of the work.
- A product or preference call that no principle settles.
- A collision between principles that this file does not settle.
- Any action that cannot be undone.
