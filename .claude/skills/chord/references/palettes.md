# chord accent palettes

The accent is the one color decision in a chord UI. Everything else (neutrals,
shadows, semantic colors) is fixed by `tokens.css`. Use the accent hard: one
primary button, the active nav item, the focus ring, the selected state. Do not
spread it thin across headings, icons, and borders.

## Choosing

1. If the user names a color or a hex, use that (see "Custom hex" below).
2. Otherwise pick a preset that fits the product's mood and say which one you
   chose in one sentence so the user can swap it.
3. Default when nothing else applies: Cobalt.

## Presets

All values are OKLCH so hover/active derivations in `tokens.css` behave the
same across hues. `--on-accent` is the text color that sits on the accent;
yellow and lime need dark text, everything else takes white.

| Preset | Mood | `--accent` | `--on-accent` |
| --- | --- | --- | --- |
| Cobalt (default) | trustworthy, tools, dashboards | `oklch(52% 0.23 262)` | `#fff` |
| Signal Red | bold, editorial, food, sport | `oklch(58% 0.22 27)` | `#fff` |
| Cadmium Yellow | playful, creative, kids, warnings-as-brand | `oklch(85% 0.17 92)` | `oklch(22% 0.02 92)` |
| Leaf Green | growth, health, finance, done-states | `oklch(60% 0.17 150)` | `#fff` |
| Tangerine | energetic, commerce, calls to action | `oklch(68% 0.19 45)` | `#fff` |
| Ultramarine | deep, premium, developer tools | `oklch(45% 0.2 275)` | `#fff` |
| Ink | monochrome, editorial, luxury | `oklch(22% 0.01 260)` in light, `oklch(95% 0 0)` in dark | inverse of accent |

Bauhaus means the three primaries (red, blue, yellow) plus black and white, used
flat and confident. The presets extend that with two secondary hues that stay
inside the same logic: saturated, single-hue, no gradient.

## Applying a preset

```css
:root {
  --accent: oklch(58% 0.22 27);   /* Signal Red */
  --on-accent: #fff;
}
```

For Ink (monochrome), the accent must flip in dark mode:

```css
:root { --accent: oklch(22% 0.01 260); --on-accent: #fff; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --accent: oklch(95% 0 0); --on-accent: oklch(18% 0 0); } }
:root[data-theme="dark"] { --accent: oklch(95% 0 0); --on-accent: oklch(18% 0 0); }
```

## Custom hex

Any hex works because the derived tokens use `color-mix(in oklab, …)`. Two
checks before shipping:

- **Contrast of `--on-accent`.** If the accent's lightness (L in OKLCH) is
  above roughly 70%, use dark text (`oklch(22% 0.02 <hue>)`). Below that, use
  white. When unsure, compute WCAG contrast; body-size text on a button needs
  4.5:1.
- **Dark-mode legibility.** Very dark accents (L under 40%) disappear on the
  dark canvas. Give dark mode a lighter variant:

```css
:root { --accent: #1e2a78; --on-accent: #fff; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --accent: oklch(from #1e2a78 65% c h); } }
:root[data-theme="dark"] { --accent: oklch(from #1e2a78 65% c h); }
```

Relative color syntax (`oklch(from …)`) is supported in all current browsers.
If the project must support older ones, hardcode the lighter value instead.

## Semantic colors

Fixed, never restyled by the accent:

| Token | Use |
| --- | --- |
| `--danger` | destructive actions, errors, invalid fields |
| `--warn` | caution, pending, needs attention |
| `--ok` | success, complete, online |
| `--info` | neutral notice |

If the accent is Signal Red, primary buttons and danger buttons will look
similar. Give danger buttons the secondary treatment with red text and a red
soft background so the destructive action still reads as different.
