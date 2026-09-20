# React in this repo

The concrete shape of composer's principles for `packages/trace-ui` and any
UI package that follows it. Agreed in issue #100.

## Runtime

- Hono serves the pages. React 19 renders them to a string on the server
  (`renderToString`), returned with `c.html(...)`.
- There is no client bundle and no hydration. Nothing runs in the browser,
  so there are no event handlers, no state, no effects. Interaction is
  forms and links.
- Suspense and streaming are not used until a component actually awaits
  something. The boundary that would allow it — routes read, pages receive
  values — is kept so it can be added without moving code.
- Components import types from `@mg/trace/store` only. Nothing in a UI
  package imports `@mg/trace` root, `@mg/harness`, or `@mg/core`.

## Layers

Generic, domain-agnostic parts — Table, Card, Button, Badge, Heading, Layout,
Meta, Quote, Role, TextField — live in the separate `packages/ui` package
(`@mg/ui`), one flat `components/<Name>/` per part, with its own
`styles/tokens.css` (see tailwind.md). Import them as `@mg/ui`, never by a
relative path into another package's `src/`. `@mg/ui` depends on nothing
else in this repo. The page shell (`Layout`) is one of these generic parts:
it takes the CSS to embed and the scheme form's destination as props, and
reads no file itself (see `scheme.ts` below and tailwind.md).

A screen-owning package such as `trace-ui` keeps its own `src/` on top of
that:

```
src/
├── routes/                   Hono handlers. The only place a reader is called.
├── components/
│   ├── pages/<Name>Page/     One page = one component. Arranges feature parts.
│   └── feature/<Name>/       Knows what a span, session, or message is.
├── hooks/                    Logic shared by more than one component.
├── styles.ts                 Reads the package's own built CSS once (see tailwind.md).
├── styles/index.css          Imports @mg/ui/tokens.css (see tailwind.md).
├── stories/fixtures.ts       Fixed SessionTree / SpanNode / SessionSummary values.
└── vocabulary.ts             Span and attribute names.
```

Each layer imports only from the layers below it.

| Layer | May import | Receives | Must not |
| --- | --- | --- | --- |
| routes | pages, `@mg/trace/store` | the reader | render markup, transform data |
| pages | feature, `@mg/ui`, `src/hooks` | what the route read, plus the CSS, as props | call a reader, parse anything |
| feature | `@mg/ui`, own `hooks/`, `src/hooks`, store types | domain values (`SpanNode`, `SessionTree`…) | contain raw markup a `@mg/ui` part already provides |

The route hands the page exactly what the reader returned, plus the CSS
string the package's own `app.tsx` assembled it with. Reshaping is a hook,
not a line in the route and not a line in the page.

`@mg/ui`'s own `scheme.ts` holds the `Scheme` type, the scheme form's field
name (`SCHEME_FIELD`), and `parseScheme`. A screen-owning package keeps only
its own cookie name in its `scheme.ts`, and reads `Scheme` and `parseScheme`
from `@mg/ui`.

| You are adding | Put it in |
| --- | --- |
| a page reachable by URL | `routes/` (handler) + `pages/` (component) |
| something that shows a span, message, session | `feature/` |
| a visual element with no domain meaning, including page chrome | `packages/ui`'s `components/<Name>/` |
| a parse, format, derive, sort, or group step | `hooks/` next to the one component that uses it |
| the same step used by two components | `src/hooks/` |
| a colour, font, radius, shadow | `packages/ui/src/styles/tokens.css`, after asking the developer |
| example data for stories and tests | `stories/fixtures.ts` |

## Naming and files

- Directory and file names are the component name in PascalCase:
  `@mg/ui`'s `components/Badge/Badge.tsx` and `components/Layout/Layout.tsx`,
  a screen package's `feature/SpanTree/SpanTree.tsx`,
  `pages/SessionPage/SessionPage.tsx`.
- Hooks are camelCase with the `use` prefix: `hooks/useChatMessages.ts`,
  test beside it as `useChatMessages.test.ts`.
- Every component directory has an `index.ts` exporting only what other
  directories import. `@mg/ui`'s `src/index.ts` re-exports every generic
  part plus `scheme.ts`.
- Importers stop at the directory: `@mg/ui`, `../../feature/SpanTree`.
  Never reach into another directory's files, in this package or another.
- A component directory holds at most: the component, sibling
  sub-components used only by it, `hooks/`, `Name.stories.tsx`,
  `Name.test.tsx`, `index.ts`.

## Props

The props type is the component's whole contract. Shape it so the wrong
use is hard to write.

- **Unions, not booleans, for appearance.** `tone: "primary" | "neutral"`,
  `size: "sm" | "md"`, never `primary?: boolean`. A boolean cannot grow a
  third value without a migration. `disabled` is the exception: it is
  really on/off and it is an HTML attribute.
- **Variants are the API of a ui part.** Every visual state is a named
  variant. Callers pick one; they do not pass `className` or `style`. This
  is what keeps principle 4 enforceable: an escape hatch on a shared part
  is a door for bare values that lint cannot see coming.
- **`children` for content, named props for structure.** `Card` takes
  `children`. `TextField` takes `label`, `hint`, `error` because each has a
  fixed place in the markup and an accessibility link to the input.
- **Domain types stop at feature.** `SpanTree` takes a `SpanNode`; the
  `Card` it renders takes `tone`. A ui part that wants to know about spans
  is a feature part in the wrong folder.
- **Pages take what the route has.** `SessionPage` takes
  `{ session: SessionTree }` because that is what `reader.readSession`
  returns. No pre-digested view model crosses the route boundary.
- **No callbacks.** There is no client JS. A `Button` submits its form or
  is an `<a>` with `href`.
- **Accessibility is a prop concern.** `TextField` derives the input `id`
  from `name`, sets `for` on the label, wires `aria-describedby` to hint
  and error. Test it.
- **Optional means optional.** A `?` prop has a sensible absence, and a
  story shows it.

## Hooks

Hooks here are plain synchronous functions. There is no client, so
`useState` and `useEffect` have nothing to do; the `use` prefix is kept so
the reader knows where the logic for a component lives. A hook:

- takes the props or domain value the component received,
- returns a plain object (prefer a discriminated union with `kind` over
  `T | undefined`, so markup branches on a name),
- imports no React,
- lives in `hooks/` next to the one component that calls it, with its test,
- moves to `src/hooks/` the moment a second component needs it.

Always a hook, never inline in a `.tsx`:

- `JSON.parse`, string splitting, regex.
- Reading an attribute by key and checking its type.
- Deciding whether something is an error, empty, or partial.
- Sorting, grouping, counting, formatting a date or number.
- Any `if` that a test would want to name.

The hook's test covers present, absent, and wrong-typed input. Most
components then need no test of their own; the story snapshot covers the
markup.

## Stories and regression

Stories are written once and used twice: Storybook (`@storybook/react-vite`,
CSF3) shows them, and `src/components/stories.test.tsx` renders every one
to HTML with `renderToString` and compares it to the saved snapshot.

- **Props only.** A story passes values from `stories/fixtures.ts`; it never
  starts a server or opens a reader. A component that cannot be rendered
  this way has its logic in the wrong place. `@mg/ui` has no fixtures file
  and knows no domain type, so its stories inline the same values as plain
  object literals instead.
- **Fixed values.** Timestamps and ids come from fixtures, never
  `new Date()` or a random id. A snapshot that changes every run protects
  nothing.
- **One story per meaningful case.** Each variant of a ui part; empty and
  populated for a list; error and success shape for a feature part; the
  page with a realistic fixture.

When a snapshot fails, read the diff. If the change is the one you meant,
`pnpm test -- -u` and commit the snapshot with the code. If not, that is
the regression the test exists for.

## Checks before a PR

`pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm lint` all green.

## Review checklist

- Every component is in the layer the table says, and imports only
  downward.
- No `JSON.parse`, attribute lookup, or formatting inside a `.tsx` render.
- Every hook has a test beside it.
- No `className` or `style` prop on a ui part; variants instead.
- No boolean prop that describes appearance.
- Every component has a stories file; every story uses fixtures, or, inside
  `@mg/ui`, inline literal values.
- Snapshots changed only where the diff was intended, and were read.
- Nothing under `components/` imports `@mg/trace` root, `@mg/harness`, or
  `@mg/core`. Nothing under `@mg/ui`'s `components/` imports any `@mg/*`
  package at all.
