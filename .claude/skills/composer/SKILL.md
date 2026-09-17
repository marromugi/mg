---
name: composer
description: "How UI code is designed and structured in this repo, independent of framework: one responsibility per component, logic kept out of rendering so it can be tested alone, design tokens as the only source of visual values, and the right granularity — split a part into a generic ui layer when its purpose is generic, keep it with its feature when it is not, and never patch a one-off in place. Framework specifics (React layers, naming, props, hooks, stories) and Tailwind specifics live in references/stacks; token values live in the project's token file. Use this whenever you create, move, split, or review a component, page, hook, story, or route in packages/trace-ui or any other UI package here — even when the user only says 「コンポーネントを作って」「画面を足して」「props を整理して」「hooks に出して」「story を書いて」「どこに置けばいい？」 and never mentions structure. Also use it when the architect or implementer skill touches UI code, so issues and PRs follow the same shape. phrasing decides what the UI must do for the person; composer decides where code goes and how it is shaped. Not for terminal output, the trace store, or non-UI packages."
---

# composer

composer says what a button is responsible for, where the logic
that feeds it lives, how it is cut from the rest of the screen, and how it is
tested. The principles below hold for any UI framework. The React and
Tailwind specifics this repo uses are in `references/`, and the last section
says when to read them.

The reason it exists: a UI grows one component at a time, and each one is a
small chance to put something in the wrong place. Parsing inside a render,
a component that reaches for the database, a boolean that later needs a
third value, a colour typed by hand because the token was not there yet.
None of these are wrong on the day they are written; they are wrong six
components later. composer front-loads the choices so every component is
written the same way and can be judged at a glance.

## 1. One responsibility per component

A component does one thing, and its name says which. It either arranges
other parts, or shows one piece of the domain, or draws one visual element.
Not two of those.

The test: describe the component in one sentence without "and". "Shows the
messages of an LLM call" is one component. "Shows the messages and decides
whether the call failed and lays out the page" is three.

Why it matters: a component with one job has one reason to change. When the
error styling changes, only the part that draws errors moves; the part that
knows what an error *is* stays put, and so does the page that places it.

What it looks like when broken: a component whose props keep growing;
`if` branches that switch between unrelated layouts; a component you cannot
render in isolation because it needs three kinds of data at once.

## 2. Logic is separate from rendering

Rendering turns already-decided values into markup. Every decision that
produces those values — parsing, reading a field and checking its type,
deciding whether something is an error or empty, sorting, grouping,
formatting — is a plain function outside the render, next to the component,
with its own test.

The test: could the decision be checked without rendering anything? If yes,
it is not rendering, and it does not belong in the render.

Why it matters: a plain function is tested by calling it with three inputs.
A decision buried in markup is tested by rendering, searching the output,
and guessing which branch ran. The first test is written; the second is
skipped. Separation is what makes testability real rather than aspirational.

The corollary: the render function of a component reads as *call the
functions, branch on their results, return markup*. If it reads as anything
more, something is in the wrong place.

## 3. Testable in isolation

Every component renders from its inputs alone. It does not fetch, open a
store, read a clock, or generate an id. Whatever it needs is handed in.

Why it matters: a component that renders from inputs can be shown in a
catalogue with fixed example data, snapshotted, and compared after every
change. A component that fetches needs a server to exist, and so it is
looked at only when the whole app runs — which is exactly when regressions
are hardest to attribute.

The consequence for layering: reading data happens at the edge (the route
or whatever receives the request), and the result is passed inward. Data
flows down as values; nothing inside reaches up for it.

## 4. Design tokens are the only visual vocabulary

Every colour, font, size, radius, and shadow in a component comes from the
token set. Which tokens exist, what values they hold, and how they are meant
to be used — one scarce accent, the radius scale, the spacing rhythm, dark
mode — lives in the token file itself (`packages/trace-ui/src/styles/tokens.css`),
the only source of those values. composer's rule is
only about the relationship between a component and the tokens: use them,
never bypass them, and never add one on your own.

If the token you need is missing, stop and ask the developer before adding
it. Say which value, which name, and where it would be used. A token is a
word added to the shared vocabulary, and the developer decides what words
the vocabulary has. Writing the bare value in place instead is not an
option either.

Why it matters: tokens are how a screen stays one screen. A hand-typed
value looks right today and drifts the first time the token changes. Bare
values are caught mechanically; what no tool catches is a component built
so that bypassing tokens is convenient — an open `className` or `style`
prop on a shared part, for instance. Design so that the token is the easy
path and the bare value has nowhere to go.

## 5. The right granularity, decided per component

Neither "make everything reusable" nor "inline it and move on". The unit of
judgement is one component, and the question is: **is this component's
purpose generic, or is it specific to this feature?**

- If the purpose is generic — a card, a table, a badge, a text field, a
  button — it would make sense in a different product. It goes in the
  shared `ui` layer, takes only presentational inputs, and knows nothing
  about the domain.
- If the purpose is specific — a span tree, a session list, a chat
  transcript — it belongs with its feature. It may use ui parts freely; it
  does not become one.

Two failure modes, opposite in direction, same cost:

- **Premature generalisation**: a `DataGrid` with twelve options built for
  one table. Every future table pays for options it does not use, and the
  one table that needed it would have been simpler as its own component.
- **Ad-hoc patching**: a bordered `<div>` copied into a third place with one
  class changed, because extracting a `Card` felt like too much. The third
  copy is where the drift starts, and the extraction gets harder each time.

The rule between them: extract when the purpose is generic, not when the
markup happens to repeat. Two features that both draw a bordered box share
a `Card` because "a bordered box" is a generic purpose. Two features that
both render a list of spans do not share a `SpanList` unless "a list of
spans" is the same thing in both.

And when a specific component needs a small variation of a ui part, the
variation becomes a named variant of the ui part. It does not become a
patched copy, and it does not become an escape hatch on the ui part.

## 6. Design for the change you can see, not the one you imagine

Do not add a prop, a variant, or an abstraction for a use that does not yet
exist. Do add the one that a visible requirement asks for, in the shape
that lets the next visible requirement fit without a rewrite — a union
where a boolean would lock in two values, a named variant where a class
string would invite a third copy.

The difference between this and principle 5 is direction: 5 says where a
component goes, 6 says how much of it to build. Both answer the same
question — what does the code in front of you actually need?

## Working through a component

1. State its one responsibility in a sentence. Pick the layer with
   principle 5 and say why in a line.
2. Write its inputs first. Check them against the props guidance in the
   framework reference.
3. List what the render needs that the inputs do not directly give. Each
   item is a function outside the render. Write it and its test before the
   markup.
4. Write the markup from ui parts and tokens. Every visual value comes from a token.
   A missing token is a question to the developer, not a value to type.
5. Write the catalogue entries (stories): one per meaningful case, from
   fixed example data.
6. Run the checks. Read any snapshot diff before accepting it.

## References

Read these when the work touches the thing they describe; skip them when
it does not.

- `references/stacks/react.md` — the React shape of these principles in this repo:
  directory layers and what each may import, file naming, the props
  contract (unions over booleans, no callbacks, accessibility as props),
  hooks as plain functions, stories as fixtures, the snapshot regression
  test, the review checklist. Read it before writing or reviewing any
  component here.
- `references/stacks/tailwind.md` — where the token file lives, how
  variants are declared, why ui parts take no `className`, how the CSS
  reaches the page. Read it before touching styling. The values themselves
  live in the token file.
- `references/example.md` — one feature component with its hook and test,
  the ui part it uses, the page, the route, and the stories, written the way
  the references ask. Read it the first time you build something in this
  package.
