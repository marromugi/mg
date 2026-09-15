# chord component recipes

Working CSS for the pieces almost every UI needs. Every recipe assumes
`tokens.css` is loaded. Copy the recipe, keep the states, adapt the markup to
your framework (React, Vue, Svelte, Tailwind `@apply`, plain HTML all work).

Every interactive element here ships with four states: hover, active,
focus-visible, disabled. Do not drop them when adapting.

Contents:

1. Buttons
2. Cards and surfaces
3. Inputs, textarea, select
4. Toggle switch and checkbox
5. Segmented control and tabs
6. Dropdown menu and popover
7. Dialog and scrim
8. Toast
9. Tooltip
10. Sidebar navigation
11. List rows and tables
12. Badges and chips
13. Theme toggle (JS)

---

## 1. Buttons

Three tiers. One primary per view. Hover lifts, active presses. The press is
the neumorphic moment: shadow collapses, surface dips.

```css
.btn {
  display: inline-flex; align-items: center; gap: var(--s-2);
  height: 44px; padding: 0 var(--s-5);
  border-radius: var(--r-md); border: 0;
  font-weight: 600; font-size: var(--fs-sm); letter-spacing: 0.005em;
  cursor: pointer; user-select: none;
  transition: transform var(--dur-1) var(--ease-out),
              box-shadow var(--dur-1) var(--ease-out),
              background-color var(--dur-1) var(--ease-out),
              color var(--dur-1) var(--ease-out);
}
.btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none !important; box-shadow: none !important; }

.btn-primary {
  background: var(--accent); color: var(--on-accent);
  box-shadow: var(--edge), var(--shadow-sm), 0 6px 16px color-mix(in oklab, var(--accent) 30%, transparent);
}
.btn-primary:hover  { background: var(--accent-hover); transform: translateY(-1px);
                      box-shadow: var(--edge), var(--shadow-md), 0 10px 24px color-mix(in oklab, var(--accent) 35%, transparent); }
.btn-primary:active { background: var(--accent-active); transform: translateY(0) scale(0.98);
                      box-shadow: inset 0 2px 6px oklch(0% 0 0 / 0.25); transition-duration: 120ms; }

.btn-secondary {
  background: var(--surface); color: var(--text);
  box-shadow: var(--edge), var(--shadow-sm), 0 0 0 1px var(--line);
}
.btn-secondary:hover  { transform: translateY(-1px); box-shadow: var(--edge), var(--shadow-md), 0 0 0 1px var(--line); }
.btn-secondary:active { background: var(--surface-2); transform: scale(0.98);
                        box-shadow: var(--shadow-inset), 0 0 0 1px var(--line); transition-duration: 120ms; }

.btn-ghost { background: transparent; color: var(--text-2); }
.btn-ghost:hover  { background: var(--surface-2); color: var(--text); }
.btn-ghost:active { background: var(--surface-3); transform: scale(0.98); transition-duration: 120ms; }

.btn-danger { background: var(--danger); color: #fff; box-shadow: var(--edge), var(--shadow-sm); }
.btn-danger:hover  { background: color-mix(in oklab, var(--danger), var(--text) 12%); transform: translateY(-1px); box-shadow: var(--edge), var(--shadow-md); }
.btn-danger:active { transform: scale(0.98); box-shadow: inset 0 2px 6px oklch(0% 0 0 / 0.25); transition-duration: 120ms; }

/* icon-only */
.btn-icon { width: 44px; padding: 0; justify-content: center; border-radius: var(--r-md); }
.btn-sm { height: 36px; padding: 0 var(--s-4); border-radius: var(--r-sm); }
.btn-lg { height: 52px; padding: 0 var(--s-6); font-size: var(--fs-md); border-radius: var(--r-lg); }
```

The active state uses a shorter transition (120ms) on purpose: the press must
feel immediate even though everything else is slow and calm.

## 2. Cards and surfaces

A card is a raised surface. Padding is generous (24–32px). Cards that are
clickable get the same hover lift as buttons; cards that are not, stay still.

```css
.card {
  background: var(--surface);
  border-radius: var(--r-lg);
  padding: var(--s-6);
  box-shadow: var(--edge), var(--shadow-md), 0 0 0 1px var(--line);
}
.card-interactive { cursor: pointer; transition: transform var(--dur-1) var(--ease-out), box-shadow var(--dur-1) var(--ease-out); }
.card-interactive:hover  { transform: translateY(-2px); box-shadow: var(--edge), var(--shadow-lg), 0 0 0 1px var(--line); }
.card-interactive:active { transform: translateY(0) scale(0.995); box-shadow: var(--edge), var(--shadow-sm), 0 0 0 1px var(--line); transition-duration: 120ms; }

/* Inset well: content that sits *into* the surface (code, previews, empty states) */
.well {
  background: var(--surface-2);
  border-radius: var(--r-md);
  padding: var(--s-5);
  box-shadow: var(--shadow-inset);
}

/* Floating glass: headers, toolbars, floating action bars. Only for layers
   that actually float over scrolling content. */
.glass {
  background: var(--glass-bg);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border-radius: var(--r-lg);
  box-shadow: var(--edge), var(--shadow-lg), 0 0 0 1px var(--line);
}
```

## 3. Inputs, textarea, select

Inputs are wells (slightly inset) that rise to meet you on focus.

```css
.field { display: grid; gap: var(--s-2); }
.field > label { font-size: var(--fs-sm); font-weight: 600; color: var(--text-2); }
.field > .hint { font-size: var(--fs-xs); color: var(--text-3); }
.field > .error { font-size: var(--fs-xs); color: var(--danger); font-weight: 600; }

.input {
  width: 100%; box-sizing: border-box;
  height: 48px; padding: 0 var(--s-4);
  background: var(--surface-2); color: var(--text);
  border: 0; border-radius: var(--r-md);
  box-shadow: var(--shadow-inset), 0 0 0 1px var(--line);
  transition: box-shadow var(--dur-1) var(--ease-out), background-color var(--dur-1) var(--ease-out);
}
.input::placeholder { color: var(--text-3); }
.input:hover { box-shadow: var(--shadow-inset), 0 0 0 1px var(--line-strong); }
.input:focus { outline: none; background: var(--surface);
               box-shadow: 0 0 0 1px var(--accent), var(--ring); }
.input:disabled { opacity: 0.5; cursor: not-allowed; }
.input[aria-invalid="true"] { box-shadow: 0 0 0 1px var(--danger), 0 0 0 4px color-mix(in oklab, var(--danger) 30%, transparent); }
textarea.input { height: auto; min-height: 120px; padding: var(--s-3) var(--s-4); resize: vertical; line-height: 1.5; }

/* Native select with a custom chevron */
select.input {
  appearance: none; padding-right: var(--s-7);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right var(--s-4) center;
}
```

## 4. Toggle switch and checkbox

The switch thumb is a tiny raised surface; the track is a well. The thumb
travels with a bounce because it is a physical thing landing.

```css
.switch { position: relative; width: 52px; height: 32px; flex: none; cursor: pointer; }
.switch input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
.switch .track {
  position: absolute; inset: 0; border-radius: var(--r-full);
  background: var(--surface-3); box-shadow: var(--shadow-inset);
  transition: background-color var(--dur-1) var(--ease-out);
}
.switch .thumb {
  position: absolute; top: 4px; left: 4px; width: 24px; height: 24px;
  border-radius: var(--r-full); background: var(--surface);
  box-shadow: var(--edge), var(--shadow-sm), 0 0 0 1px var(--line);
  transition: transform var(--dur-2) var(--ease-bounce), width var(--dur-1) var(--ease-out);
}
.switch:hover .thumb { box-shadow: var(--edge), var(--shadow-md), 0 0 0 1px var(--line); }
.switch:active .thumb { width: 30px; }                                     /* squish while pressed */
.switch input:checked ~ .track { background: var(--accent); }
.switch input:checked ~ .thumb { transform: translateX(20px); background: #fff; }
.switch input:checked:active ~ .thumb { transform: translateX(14px); }
.switch input:focus-visible ~ .track { box-shadow: var(--shadow-inset), var(--ring); }
.switch input:disabled ~ * { opacity: 0.5; cursor: not-allowed; }

.checkbox {
  appearance: none; width: 22px; height: 22px; margin: 0; flex: none;
  border-radius: 7px; background: var(--surface-2);
  box-shadow: var(--shadow-inset), 0 0 0 1px var(--line);
  display: grid; place-content: center; cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out), box-shadow var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
.checkbox::before { content: ""; width: 12px; height: 12px; transform: scale(0);
  transition: transform var(--dur-2) var(--ease-bounce);
  background: var(--on-accent);
  clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%); }
.checkbox:hover { box-shadow: var(--shadow-inset), 0 0 0 1px var(--line-strong); }
.checkbox:active { transform: scale(0.92); }
.checkbox:checked { background: var(--accent); box-shadow: var(--edge), var(--shadow-sm); }
.checkbox:checked::before { transform: scale(1); }
.checkbox:focus-visible { outline: none; box-shadow: 0 0 0 1px var(--accent), var(--ring); }
```

## 5. Segmented control and tabs

The selected segment is a raised pill sliding inside a well.

```css
.segmented {
  display: inline-flex; padding: 4px; gap: 2px;
  background: var(--surface-2); border-radius: var(--r-md);
  box-shadow: var(--shadow-inset);
}
.segmented > button {
  height: 36px; padding: 0 var(--s-4); border: 0; border-radius: 12px;
  background: transparent; color: var(--text-2); font-weight: 600; font-size: var(--fs-sm); cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out),
              box-shadow var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
.segmented > button:hover { color: var(--text); }
.segmented > button:active { transform: scale(0.97); }
.segmented > button[aria-selected="true"] {
  background: var(--surface); color: var(--text);
  box-shadow: var(--edge), var(--shadow-sm), 0 0 0 1px var(--line);
}

/* Underline tabs: the indicator slides, the text does not jump weight */
.tabs { display: flex; gap: var(--s-5); border-bottom: 1px solid var(--line); }
.tabs > button {
  position: relative; padding: var(--s-3) 0; border: 0; background: none;
  color: var(--text-2); font-weight: 600; cursor: pointer;
  transition: color var(--dur-1) var(--ease-out);
}
.tabs > button::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 3px;
  border-radius: 3px 3px 0 0; background: var(--accent);
  transform: scaleX(0); transition: transform var(--dur-2) var(--ease-out);
}
.tabs > button:hover { color: var(--text); }
.tabs > button[aria-selected="true"] { color: var(--text); }
.tabs > button[aria-selected="true"]::after { transform: scaleX(1); }
```

## 6. Dropdown menu and popover

A menu hangs from its trigger, so it pops in with `transform-origin` at the
top and a bounce. Exits are quicker and do not bounce.

```css
.menu {
  position: absolute; top: calc(100% + var(--s-2)); left: 0; min-width: 220px;
  padding: var(--s-2);
  background: var(--glass-bg); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);
  border-radius: var(--r-lg);
  box-shadow: var(--edge), var(--shadow-lg), 0 0 0 1px var(--line);
  transform-origin: top left;
  animation: chord-drop-in var(--dur-3) var(--ease-bounce);
}
.menu[data-closing] { animation: chord-pop-out var(--dur-1) var(--ease-in-out) forwards; }
.menu-item {
  display: flex; align-items: center; gap: var(--s-3); width: 100%;
  padding: var(--s-3) var(--s-3); border: 0; border-radius: var(--r-sm);
  background: none; color: var(--text); text-align: left; font-size: var(--fs-sm); cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out);
}
.menu-item:hover, .menu-item:focus-visible { background: var(--accent-soft); outline: none; }
.menu-item:active { background: var(--accent-soft-hover); transform: scale(0.99); }
.menu-item.is-danger { color: var(--danger); }
.menu-item.is-danger:hover { background: var(--danger-soft); }
.menu-sep { height: 1px; margin: var(--s-2) var(--s-3); background: var(--line); }
```

With the native Popover API, animate `[popover]:popover-open` the same way.

## 7. Dialog and scrim

The scrim fades (ease-out); the panel pops (bounce). Two different curves on
two different layers is what makes it read as a physical object arriving in a
darkened room rather than a screenshot fading in.

```css
.dialog::backdrop, .scrim {
  background: var(--scrim);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  animation: chord-fade-in var(--dur-2) var(--ease-out);
}
.dialog {
  width: min(520px, calc(100vw - var(--s-6)));
  padding: var(--s-6); border: 0;
  background: var(--surface); color: var(--text);
  border-radius: var(--r-xl);
  box-shadow: var(--edge), var(--shadow-lg), 0 0 0 1px var(--line);
  animation: chord-pop-in var(--dur-3) var(--ease-bounce);
}
.dialog[data-closing] { animation: chord-pop-out var(--dur-1) var(--ease-in-out) forwards; }
.dialog[data-closing]::backdrop { animation: chord-fade-out var(--dur-1) var(--ease-out) forwards; }
.dialog-actions { display: flex; justify-content: flex-end; gap: var(--s-3); margin-top: var(--s-6); }
```

Closing pattern (so the exit animation actually plays):

```js
function closeDialog(dialog) {
  dialog.dataset.closing = "";
  dialog.addEventListener("animationend", () => { delete dialog.dataset.closing; dialog.close(); }, { once: true });
}
```

## 8. Toast

Rises from the bottom with a bounce, leaves with a quick fade. Fixed
position, glass, one accent stripe or icon to say what kind it is.

```css
.toast-stack { position: fixed; right: var(--s-5); bottom: var(--s-5); display: grid; gap: var(--s-3); z-index: 50; }
.toast {
  display: flex; align-items: center; gap: var(--s-3);
  min-width: 280px; max-width: 420px; padding: var(--s-4) var(--s-5);
  background: var(--glass-bg); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);
  border-radius: var(--r-lg);
  box-shadow: var(--edge), var(--shadow-lg), 0 0 0 1px var(--line);
  animation: chord-rise-in var(--dur-3) var(--ease-bounce);
}
.toast[data-closing] { animation: chord-fade-out var(--dur-1) var(--ease-out) forwards; }
.toast .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); flex: none; }
.toast.is-ok .dot { background: var(--ok); }
.toast.is-danger .dot { background: var(--danger); }
.toast.is-warn .dot { background: var(--warn); }
```

## 9. Tooltip

Small, opaque (blur on something this small just looks smudged), quick fade.

```css
.tooltip {
  position: absolute; padding: var(--s-2) var(--s-3);
  background: var(--text); color: var(--bg);
  border-radius: var(--r-sm); font-size: var(--fs-xs); font-weight: 600; white-space: nowrap;
  box-shadow: var(--shadow-md);
  animation: chord-fade-in var(--dur-1) var(--ease-out);
}
```

## 10. Sidebar navigation

The active item is a raised pill on a flat rail. Hover tints, active presses.

```css
.sidebar { width: 260px; padding: var(--s-5); display: grid; gap: var(--s-1); align-content: start; }
.nav-item {
  display: flex; align-items: center; gap: var(--s-3);
  padding: var(--s-3) var(--s-4); border-radius: var(--r-md);
  color: var(--text-2); font-weight: 600; font-size: var(--fs-sm); text-decoration: none;
  transition: background-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out),
              box-shadow var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
.nav-item:hover { background: var(--surface-2); color: var(--text); }
.nav-item:active { transform: scale(0.98); }
.nav-item[aria-current="page"] {
  background: var(--surface); color: var(--accent-text);
  box-shadow: var(--edge), var(--shadow-sm), 0 0 0 1px var(--line);
}
.nav-item svg { width: 20px; height: 20px; }
```

## 11. List rows and tables

Rows are separated by space and hover tint, not by heavy borders. Numbers
right-aligned in tabular figures.

```css
.list { display: grid; gap: var(--s-1); }
.row {
  display: grid; grid-template-columns: 1fr auto; align-items: center; gap: var(--s-4);
  padding: var(--s-4); border-radius: var(--r-md);
  transition: background-color var(--dur-1) var(--ease-out);
}
.row:hover { background: var(--surface-2); }
.row[aria-selected="true"] { background: var(--accent-soft); }

.table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: var(--fs-sm); }
.table th { text-align: left; padding: var(--s-3) var(--s-4); color: var(--text-3); font-weight: 600; font-size: var(--fs-xs); letter-spacing: var(--tracking-wide); text-transform: uppercase; }
.table td { padding: var(--s-4); border-top: 1px solid var(--line); }
.table td.num, .table th.num { text-align: right; font-variant-numeric: tabular-nums; }
.table tbody tr { transition: background-color var(--dur-1) var(--ease-out); }
.table tbody tr:hover { background: var(--surface-2); }
```

## 12. Badges and chips

Flat, tinted, with full-strength text of the same hue. Never a gradient.

```css
.badge {
  display: inline-flex; align-items: center; gap: 6px;
  width: fit-content; height: 26px; padding: 0 var(--s-3); border-radius: var(--r-full);
  font-size: var(--fs-xs); font-weight: 700;
  background: var(--accent-soft); color: var(--accent-text);
}
.badge.is-ok     { background: var(--ok-soft);     color: color-mix(in oklab, var(--ok), var(--text) 25%); }
.badge.is-warn   { background: var(--warn-soft);   color: color-mix(in oklab, var(--warn), var(--text) 45%); }
.badge.is-danger { background: var(--danger-soft); color: color-mix(in oklab, var(--danger), var(--text) 20%); }

.chip { /* same box as .badge */ display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 var(--s-3); border-radius: var(--r-full); font-size: var(--fs-xs); font-weight: 700; background: var(--accent-soft); color: var(--accent-text); border: 0; cursor: pointer; transition: background-color var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out); }
.chip:hover  { background: var(--accent-soft-hover); }
.chip:active { transform: scale(0.96); }
.chip[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); }
```

## 13. Theme toggle (JS)

Respect the system by default, let the user override, remember the override.

```js
const root = document.documentElement;
const saved = localStorage.getItem("theme");          // "light" | "dark" | null
if (saved) root.dataset.theme = saved;
function toggleTheme() {
  const dark = root.dataset.theme
    ? root.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  localStorage.setItem("theme", root.dataset.theme);
}
```

Put the toggle inline in `<head>` (before paint) to avoid a flash of the wrong
theme.
