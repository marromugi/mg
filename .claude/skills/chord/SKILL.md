---
name: chord
description: "Visual design system for any user-facing UI: soft, translucent surfaces with generous rounding and calm 300–450ms motion, paired with flat Bauhaus-clear color and full hover/active/focus states, in light and dark mode. Use this whenever you write or restyle HTML, CSS, Tailwind, React, Vue, Svelte, or any component, page, dashboard, form, landing page, modal, or prototype that a person will look at — even if the user only says 「画面を作って」「UI を作って」「見た目を整えて」「コンポーネントを書いて」「デザインして」 or just asks for a page and never mentions design. Also use it when the user complains that a UI looks generic, template-like, or 'AI っぽい'. Not for terminal output, logs, or non-visual code."
---

# chord

chord is a house style for interfaces. The short version:

> Soft in form, confident in color, unhurried in motion.

Surfaces are rounded, slightly translucent, and lifted by layered shadows,
close to neumorphism but with real contrast. Color is the opposite of soft:
one flat, saturated accent in the spirit of Bauhaus primaries, on a calm
near-white or near-black canvas. Motion takes its time (300–450ms), pops in
with a small bounce, fades out gently. Every interactive element answers the
pointer: hover, active, focus, disabled.

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
Radius is a scale, and the size of the thing decides the size of the corner:

| Element | Radius |
| --- | --- |
| chips, checkboxes, small controls | `--r-sm` 10px |
| buttons, inputs, list rows, nav items | `--r-md` 16px |
| cards, popovers, toasts | `--r-lg` 24px |
| dialogs, sheets, hero panels | `--r-xl` 32px |
| badges, switches, avatars | `--r-full` |

Nested corners: inner radius = outer radius − padding. A 24px card with 8px
padding holds 16px children.

## Color

One accent, fixed neutrals, fixed semantic colors. The accent is loud so it
must be scarce: the primary button, the selected item, the focus ring, the
active tab indicator, one badge. Headings are `--text`, not the accent. Icons
are `currentColor`. Borders are `--line`, never colored.

No gradients. Not on buttons, not on text, not as a background wash. Bauhaus
color is flat color placed with intent. If a surface needs to feel special,
give it more space, a larger radius, or the accent as a solid fill.

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
| control height | 44px default, 36px compact, 52px hero |
| body line length | `--measure` 64ch max |

Leave the margins alone. A page that feels empty at first glance is usually a
page that feels calm after ten seconds.

## Motion

Timing is deliberately slow; 300ms is the floor, not the ceiling.

| Kind | Duration | Easing | Example |
| --- | --- | --- | --- |
| hover / color / press | `--dur-1` 300ms | `--ease-out` | button lift, row tint |
| fade, small move | `--dur-2` 380ms | `--ease-out` | scrim, tooltip, tab indicator |
| pop-in (arrives) | `--dur-3` 450ms | `--ease-bounce` | dialog, menu, toast, switch thumb |
| exit (leaves) | `--dur-1` 300ms | `--ease-in-out` or `--ease-out` | closing anything |
| press feedback | 120ms | `--ease-out` | `:active` only |

Rules behind the table:

- **Things that appear, bounce.** A menu, dialog, or toast is an object
  arriving; a ~10% overshoot (`--ease-bounce`) makes it land. Scale from
  0.92 plus a small translate toward the trigger, with `transform-origin` at
  the trigger.
- **Things that fade, ease out.** Opacity and color changes decelerate into
  place. Never ease-in a fade-in; it lags.
- **Exits are quicker and never bounce.** Leaving with a bounce looks like a
  mistake. 300ms, scale to 0.96, opacity to 0.
- **The press is the exception to slow.** `:active` transitions at ~120ms
  so the button feels attached to the finger.
- **Two layers, two curves.** A dialog's scrim fades (ease-out) while the
  panel pops (bounce). One curve for both flattens it into a screenshot.
- **Only `transform` and `opacity` animate**, plus `background-color`,
  `box-shadow`, and `color` on hover. Never animate `width`, `height`, `top`,
  `left`, or `filter` on anything larger than a switch.
- `prefers-reduced-motion` collapses everything to near-instant; the tokens
  file handles it, do not remove that block.

Keyframes ready in `tokens.css`: `chord-fade-in/out`, `chord-pop-in/out`,
`chord-rise-in` (toasts), `chord-drop-in` (menus).

## States

Every element a pointer can touch has all four. It is not optional and it is
not a polish step; it is what makes the surfaces feel real.

| State | Raised (buttons, cards) | Inset (inputs) | Flat (nav, rows, ghost) |
| --- | --- | --- | --- |
| hover | lift 1–2px, shadow grows, accent → `--accent-hover` | ring `--line-strong` | tint `--surface-2` |
| active | scale 0.98, shadow collapses to inset | (no change) | tint `--surface-3`, scale 0.98 |
| focus-visible | `--ring` (4px accent at 45%) | ring + `--accent` 1px | `--ring` |
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
