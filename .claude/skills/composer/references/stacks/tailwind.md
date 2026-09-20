# Tailwind in this repo

## Tokens

`packages/ui/src/styles/tokens.css` is the token set for every UI package in
this repo. It imports Tailwind and declares every colour, font, radius, and
shadow in one `@theme` block:

```css
@import "tailwindcss";
@theme {
  --color-accent: #2f5bea;
  --color-on-accent: #ffffff;
  --color-edge: #8884;
  --color-error: #d33;
  /* ... */
}
```

A token becomes a class family: `--color-accent` gives `bg-accent`,
`text-accent`, `border-accent`. Spacing, sizes, and type scale come from
Tailwind's built-in scale unless the file says otherwise (the file's first
line records whether defaults were cleared).

What goes in this file — the palette, the radius and spacing scales, dark
mode values, and the rules for using them — is decided in this file. It is
the only source of those values.

If the class you want does not exist, do not add the token yourself and do
not write `bg-[#2f5bea]` or `w-[320px]`. Ask the developer, naming the
value, the token name, and the place it would be used, and continue once
they answer.

## Variants

Any component with more than one visual state declares them with
`tailwind-variants`:

```tsx
import { tv } from "tailwind-variants";

const card = tv({
  base: "rounded-lg border p-4",
  variants: {
    tone: {
      default: "border-edge",
      error: "border-error bg-error-bg text-error-fg",
    },
  },
  defaultVariants: { tone: "default" },
});

export const Card = ({ tone, children }: CardProps) => (
  <div className={card({ tone })}>{children}</div>
);
```

The variant names are the component's props (`tone?: "default" | "error"`).
A new visual state is a new entry in `variants`, never a class string
passed in by the caller. `tv()` already merges and de-duplicates classes,
so `clsx` is not needed.

## How the CSS reaches the page

`@mg/ui` does not generate CSS. It exports `tokens.css` as a raw file
(`"./tokens.css"` in its `package.json`), and the file declares an `@source`
pointing at its own `components/`, so any package that imports it also picks
up `@mg/ui`'s classes.

A screen-owning package such as `trace-ui` has its own small CSS entry
(`src/styles/index.css`) that contains only `@import "@mg/ui/tokens.css";`.
There is no bundler on the server. `pnpm build` runs `tsc` and then the
Tailwind CLI on that entry, which scans the package's own `src/` (and, via
the `@source` in `tokens.css`, `@mg/ui`'s `src/components/`) and writes
`dist/styles.css`. The `Layout` ui part reads that file once at startup and
inlines it in a `<style>` tag. Storybook uses `@tailwindcss/vite` and
imports `tokens.css` in its preview — `@mg/ui/tokens.css` for a package that
consumes it, the local `src/styles/tokens.css` for `@mg/ui` itself — so
every Storybook renders from the same token set.

The practical consequence: a class only exists in the output if it appears
literally in source. Build class names from `tv()` variants or full string
literals, never by concatenating fragments (`"bg-" + tone`), or the CLI
will not find them.
