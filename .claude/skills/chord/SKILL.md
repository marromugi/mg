---
name: chord
description: "Visual design system for any user-facing UI: soft, translucent surfaces with generous rounding, quick 150–200ms answers to the user and calm 300–450ms arrivals, paired with flat Bauhaus-clear color and full hover/active/focus states, in light and dark mode. Use this whenever you write or restyle HTML, CSS, Tailwind, React, Vue, Svelte, or any component, page, dashboard, form, landing page, modal, or prototype that a person will look at — even if the user only says 「画面を作って」「UI を作って」「見た目を整えて」「コンポーネントを書いて」「デザインして」 or just asks for a page and never mentions design. Also use it when the user complains that a UI looks generic, template-like, or 'AI っぽい'. Not for terminal output, logs, or non-visual code."
---

# chord

chord is a house style for interfaces. The short version:

> Soft in form, confident in color, quick to answer, unhurried to arrive.

Surfaces are rounded, slightly translucent, and lifted by layered shadows,
close to neumorphism but with real contrast. Color is the opposite of soft:
one flat, saturated accent in the spirit of Bauhaus primaries, on a calm
near-white or near-black canvas. Motion has two speeds: a direct answer to
the user (focus, hover, press) is quick, and something arriving on screen
(menu, dialog, toast) takes its time and lands with a small bounce. Every
interactive element answers the pointer, and the answer is chosen per
element: hover, active, focus, disabled.

The reason this exists: generated UIs default to a recognizable template
(gradient buttons, blurred blobs, glass on glass, emoji icons, three feature
cards). chord shares some ingredients with that template, so the style has
to earn its look through restraint and hierarchy rather than effects.
`references/anti-slop.md` lists the tells; read it once and check against it
before you hand anything over.

## Workflow

1. **Pick the accent.** If the user gave a color, use it. Otherwise choose a
   preset from `references/palettes.md` that fits the product and tell the
   user which one in a sentence. Default is Cobalt.
2. **Load the tokens.** Copy `references/tokens.css` into the project (a
   global stylesheet, a Tailwind `@theme`, a CSS-in-JS theme object). Override
   `--accent` and `--on-accent`. Everything else derives from these variables,
   so do not hardcode colors, radii, durations, or shadows anywhere else.
3. **Build from the recipes.** `references/components.md` has working CSS
   for buttons, cards, inputs, switches, tabs, menus, dialogs, toasts,
   tooltips, sidebars, tables, badges, and the theme toggle. Adapt markup to
   the framework; keep the states and the motion.
4. **Check both themes.** Look at the result in light and dark before calling
   it done. If you can render it (headless browser, screenshot), do; if not,
   walk through the dark-mode token block and make sure nothing uses a
   hardcoded light value.
5. **Run the anti-slop list** in `references/anti-slop.md`.

When the user's project already has a design system, chord layers on top:
keep their spacing and type, bring the surfaces, color discipline, states,
and motion.

## Surfaces and depth

Think of the page as a few physical layers under a soft light from above.

- **Canvas** (`--bg`): flat, slightly tinted, nothing sits directly on it
  except text and raised surfaces.
- **Raised** (`--surface` + `--shadow-*` + `--edge`): cards, buttons,
  popovers. The `--edge` inset highlight is the top edge catching light; it
  is what makes a surface read as a thing rather than a rectangle. In dark
  mode it does most of the work, because shadows on a dark canvas are faint.
- **Inset** (`--surface-2` + `--shadow-inset`): inputs, wells, toggle tracks,
  the rail behind a segmented control. Things you put content *into*.
- **Floating glass** (`--glass-bg` + `backdrop-filter`): only for layers that
  float over scrolling content: sticky headers, toolbars, menus, toasts, the
  dialog scrim. Blur on a card that sits still on the canvas is decoration;
  blur on a bar with content moving under it is information.

Shadows are two layers (tight contact + wide ambient), vertical offset only.

Corners have a tone, and the tone is the ratio of the corner to the thing it
sits on, not the corner's size. A fixed 16px is nearly a pill on a small
button and nearly square on a large one; the same design reads differently
at every size. So no corner is picked from a scale. Every corner is derived
from one rule, applied in two places:

- **Controls** (buttons, inputs, chips, nav items) come in sizes, so their
  corner is **one third of their height**. The height itself is never set
  (see Space), so the corner is computed from the same two things the
  height comes from, the line height and the vertical padding. A 50px
  button gets 16–17px, a 38px button 12–13px, and they look like the same
  family.
- **Containers** (cards, popovers, toasts, dialogs, sheets) have no height
  of their own, so their corner comes from what they hold: **the corner of
  the control inside, plus the container's padding**. The outer arc is then
  concentric with the inner one, which is what makes a card look like it
  was built around its contents rather than drawn first and filled later.
  A container that holds only text takes the line of text as its inner
  shape: a third of the line height, plus the padding. Nesting repeats the
  rule: a dialog around a card around a button adds its padding at each
  step.

Both halves are the same idea. A control's corner is one third of the space
its text sits in; a container's corner is the control's corner plus the
space the control sits in.

## Color

One accent, fixed neutrals, fixed semantic colors. The accent is loud so it
must be scarce: the primary button, the selected item, the focus ring, the
active tab indicator, one badge. Headings are `--text`, not the accent. Icons
are `currentColor`. Borders are `--line`, never colored.

No gradients. Not on buttons, not on text, not as a background wash. Bauhaus
color is flat color placed with intent. If a surface needs to feel special,
give it more space, a larger radius, or the accent as a solid fill.

The accent is used two ways, and the two are the whole button hierarchy:

- **Filled**: accent as the background, contrasting text on top. One per
  view; it is the thing to do.
- **Tinted**: the accent at a low alpha as the background, the accent itself
  as the text. This is the secondary action, the selected item, the chip.
  It is still clearly accent-colored, but it does not compete with the
  filled one.

Tinted is what keeps dark mode vivid. A filled button in dark mode has to be
a lighter accent so dark text can sit on it, and lighter tends to mean
paler; the tinted style puts the vivid accent in the text instead, where
lightness helps rather than hurts.

Vivid does not mean high chroma on paper. Blues and cyans run out of screen
gamut early, so pick the most saturated value that is actually displayable
at the chosen lightness, and check the text on it still reads (4.5:1 for
button labels). Dark mode gets its own accent value, a step lighter and as
saturated as the gamut allows, never the light value with the alpha turned
down.

The accent as a fill and the accent as text are two values, not one. A
primary blue that carries white text as a fill is too dark to read as text
on a dark canvas; lifting the whole accent to fix that turns the fill
pastel. So the fill stays primary, and only the text variant (tinted button
labels, links, selected labels) is lifted until it reads. In light mode the
two are usually the same value.

Semantic colors (`--danger`, `--warn`, `--ok`, `--info`) stay fixed no matter
the accent, so a red accent never makes a delete button ambiguous (see the
note at the end of `palettes.md`).

Neutrals carry a faint blue tint (hue 260). Pure gray looks dead next to a
saturated accent.

## Space

Generous is the default. When in doubt, add 8px.

| Where | Value |
| --- | --- |
| inside a button, horizontal | `--s-5` 24px |
| inside a card | `--s-6` 32px (24px on small screens) |
| between cards in a grid | `--s-5` 24px |
| between form fields | `--s-5` 24px |
| between sections of a page | `--s-8` 64px to `--s-9` 96px |
| page gutter | `--s-5` on mobile, `--s-7` on desktop |
| inside a control, vertical | 12px default, 8px compact, 16px hero |
| inside an input, horizontal | 14px |
| body line length | `--measure` 64ch max |

A control has no fixed height. Its height is the sum of its vertical padding
and the line height of its text, so a button and an input with the same
padding and the same type size come out the same height without anyone
measuring. Adjust the padding, never the height.

Leave the margins alone. A page that feels empty at first glance is usually a
page that feels calm after ten seconds.

## Motion

Motion has two speeds, and which one applies depends on who started it.

- **An answer to the user is quick.** Focus ring, hover tint, press, a
  helper control that appears because the pointer arrived: 150–200ms. The
  change belongs to the gesture, so it must feel attached to it; anything
  slower reads as lag.
- **An arrival is unhurried.** A menu, dialog, toast, or panel is an object
  entering the scene: 300–450ms, with a bounce. Here the slowness is the
  point; it gives the thing weight.

| Kind | Duration | Easing | Example |
| --- | --- | --- | --- |
| answer to the user | `--dur-0` 160ms | `--ease-out` | focus ring, hover tint or shadow, clear button fading in |
| press | 200ms | `--ease-bounce` | `:active` only: grows to 1.02 |
| fade, small move | `--dur-2` 380ms | `--ease-out` | scrim, tooltip, tab indicator |
| pop-in (arrives) | `--dur-3` 450ms | `--ease-bounce` | dialog, menu, toast, switch thumb |
| exit (leaves) | `--dur-1` 300ms | `--ease-in-out` or `--ease-out` | closing anything |

Rules behind the table:

- **Things that appear, bounce.** A menu, dialog, or toast is an object
  arriving; a ~10% overshoot (`--ease-bounce`) makes it land. Scale from
  0.92 plus a small translate toward the trigger, with `transform-origin` at
  the trigger.
- **Things that fade, ease out.** Opacity and color changes decelerate into
  place. Never ease-in a fade-in; it lags.
- **Exits are quicker and never bounce.** Leaving with a bounce looks like a
  mistake. 300ms, scale to 0.96, opacity to 0.
- **The press grows, never shrinks.** A button that scales down on
  `:active` pulls its edge out from under a finger that landed near it, and
  the tap misses. So the press scales *up* a touch (1.02) with the bounce
  curve, about 200ms: the surface gives under the finger and springs back.
- **Two layers, two curves.** A dialog's scrim fades (ease-out) while the
  panel pops (bounce). One curve for both flattens it into a screenshot.
- **Only `transform` and `opacity` animate**, plus `background-color`,
  `border-color`, `box-shadow`, and `color` when a state changes. Never
  animate `width`, `height`, `top`, `left`, or `filter` on anything larger
  than a switch.
- `prefers-reduced-motion` collapses everything to near-instant; the tokens
  file handles it, do not remove that block.

Keyframes ready in `tokens.css`: `chord-fade-in/out`, `chord-pop-in/out`,
`chord-rise-in` (toasts), `chord-drop-in` (menus).

## States

Every element a pointer can touch answers it. It is not optional and it is
not a polish step; it is what makes the surfaces feel real. Which answers an
element gives depends on what the user already gets for free.

- **Hover exists to say "you found something".** Where nothing else says
  it, hover must: a button, a card, a row. Where the pointer itself already
  says it, hover is noise: a text field turns the cursor into an I-beam, so
  it gets no hover styling at all and answers on focus instead.
- **Nothing the pointer is about to touch gets smaller.** Hover does not
  move the target and press does not shrink it. Both would take the target
  away from a hand that is already committed to it.
- **Focus is the strongest answer.** Three layers: the border turns accent,
  a thin ring sits just outside it, and a soft blurred glow spreads beyond
  the ring. The glow is what makes it feel lit rather than outlined. An
  invalid field keeps the same three layers in the danger color.
- **Hover never moves the element.** A button that lifts toward the
  pointer also slides away from where the pointer is heading; a slow hand
  reaches it, a fast one overshoots. Hover changes light and color (shadow,
  tint), press changes shape (scale). Position stays put.
- **The colors of rings and glows are derived, never picked.** Mix them
  from the accent or the semantic color at reduced alpha, so they follow the
  theme on their own.

| State | Raised (buttons, cards) | Inset (inputs) | Flat (nav, rows, ghost) |
| --- | --- | --- | --- |
| hover | shadow grows, accent → `--accent-hover` | none (the I-beam is the answer) | tint `--surface-2` |
| active | scale 1.02 with bounce, shadow collapses to inset | (no change) | tint `--surface-3`, scale 1.02 with bounce |
| focus-visible | `--ring` | border `--accent` + `--ring` | `--ring` |
| disabled | opacity 0.45, no transform, `not-allowed` | opacity 0.5 | opacity 0.45 |
| selected / current | raised pill with `--edge` | | `--accent-soft` bg, `--accent-text` |

Use `:focus-visible`, not `:focus`, so mouse users do not see rings. Never
`outline: none` without a replacement.

## Dark mode

Both routes must work: the system setting and an explicit toggle.
`tokens.css` defines dark values under `prefers-color-scheme: dark` guarded by
`:not([data-theme="light"])`, and again under `[data-theme="dark"]`. The
toggle in `components.md` §13 flips `data-theme` and remembers it.

What changes in dark mode is not just the colors:

- Raised surfaces get **lighter** than the canvas (elevation = lightness).
- Shadows get deeper and the `--edge` highlight gets subtler but stays; it
  is the main cue that a surface is raised.
- The accent usually stays; very dark accents need a lighter dark-mode
  variant (`palettes.md`).
- Warn yellow gets a touch lighter so it holds against the dark canvas.
- Never `#000` canvas or `#fff` text. Tinted near-black, slightly soft white.

## Type

Headings heavy (700–800), tight (`--tracking-tight`), short. Body 16px at
1.6, `--text` not gray. Secondary text `--text-2`; `--text-3` only for hints
and table headers. Numbers in tables use `font-variant-numeric: tabular-nums`.

Pick a face on purpose. Manrope, Space Grotesk, Plus Jakarta Sans, and Sora
all have the geometric, slightly wide feel that suits flat color and big
radii; the system font is a fine choice when loading a webfont is not. Inter
at 400 is the one to avoid, not because it is bad but because it is the
default of everything.

**Japanese text** follows different rules, and `tokens.css` switches them on
through `lang="ja"`, so set it on `<html>` (or on the element) whenever the
copy is Japanese. Tight tracking and 1.15 leading that look sharp in Latin
make kanji collide; the ja rules use zero tracking, 1.3 leading on headings,
1.8 on body, weight 700 rather than 800, and a smaller display size. Long
headlines break between phrases (`word-break: auto-phrase`) instead of
mid-word; where the browser lacks it, put a `<br>` at the phrase boundary
yourself rather than letting a 4rem headline wrap at a random character.

## Delivering

- Ship a single accent decision, stated.
- Ship both themes, checked.
- Ship every state.
- Ship no gradients, no emoji icons, no lorem ipsum, no blurred blobs.
- Ship a layout that fits: grids use `minmax(0, 1fr)` columns, nothing has a
  fixed width wider than its container, and the page has no horizontal
  scroll at 1280px or at 390px. A clipped fourth card is the most common
  way a good page fails.
- If the output is a standalone HTML file, inline `tokens.css` and the
  recipes you used; do not link to files that will not exist for the user.
