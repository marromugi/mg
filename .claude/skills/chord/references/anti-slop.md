# What "AI slop" looks like, and what chord does instead

Generated UIs converge on the same handful of moves because they are the
statistically safe answer to "make it look modern". Individually each one is
fine; together they are a fingerprint. chord shares some surface traits with
that fingerprint (blur, rounded corners, shadows), so the difference has to
come from restraint, hierarchy, and color confidence. Use this as a final
check before handing over.

| Slop tell | Why it reads as generated | chord instead |
| --- | --- | --- |
| Purple-to-blue (or pink-to-orange) gradient on buttons, hero backgrounds, or text | The default "premium" gradient of every template | One flat accent from `palettes.md`. No gradients anywhere. |
| Gradient text on the headline | Same | Solid `--text`, heavy weight, tight tracking. Emphasis by weight and size. |
| Blurred colored blobs floating behind the hero | Decorative, meaningless depth | A plain canvas. Depth comes from real surfaces (cards, glass bars) that hold content. |
| Glass card on glass card on glass background | Blur everywhere means blur signals nothing | Glass only on layers that float over scrolling content: headers, toolbars, menus, toasts. Cards are opaque. |
| Every element has a 1px semi-transparent border AND a shadow AND a glow | Belt and braces | Edge highlight + shadow. The 1px `--line` ring only where a surface sits on a same-color surface. |
| `rounded-full` on everything | Pill overload flattens hierarchy | Radius scale: sm 10 / md 16 / lg 24 / xl 32. Pills only for badges, switches, avatars. |
| Emoji as icons (🚀 ✨ 🎯) | Cheapest possible iconography | Inline SVG (Lucide, Phosphor, or hand-drawn), 20px, `currentColor`, 1.75–2px stroke. |
| Hero + three feature cards with icon-title-blurb, then a testimonial row, then a CTA band | The landing page template | Lead with the actual product (a real screenshot, a live demo, a concrete example). Fewer sections, each doing one job. |
| "Unlock the power of…", "Seamlessly…", "Elevate your…" | Copy generated to fill space | Plain sentences that say what the thing does. Specific nouns. Numbers where they exist. |
| Inter, 400 weight, gray-500 body, everywhere | The zero-decision typeface | Pick one: Manrope, Space Grotesk, Plus Jakarta Sans, Sora, or the system font on purpose. Headings 700–800, body `--text` not gray. |
| Lorem ipsum, "John Doe", "Acme Inc", 5-star ratings from "Sarah K., CEO" | Placeholder content presented as design | Realistic sample data with texture: mixed lengths, an edge case, real-looking dates. |
| 3-column grid of identical cards regardless of content | Layout chosen before content | Let the content set the layout. Asymmetric grids, one large card and two small, a list where a list fits. |
| Everything centered | Symmetry as a substitute for hierarchy | Left-align text blocks. Center only short headlines and single actions. |
| Hover = slight opacity change, or nothing | Interaction as an afterthought | Hover lifts (translate + shadow), active presses (scale + inset), focus rings in accent. Every interactive element. |
| Bouncy, 150ms transitions on everything, or no transitions at all | Motion not designed | 300–450ms, ease-out for fades, bounce only for things popping in, quick non-bouncing exits. |
| Dark mode = `invert` colors, or black `#000` background with pure white text | Dark mode as a filter | Tinted near-black canvas, raised surfaces get lighter, shadows deeper, edge highlights carry the depth. |
| A "Get started" and a "Learn more" button side by side, every time | Two CTAs by reflex | One primary action per view. A secondary only when there is a real second path. |
| Stat cards with big numbers and a green "+12.5%" pill, four in a row | The dashboard template | Fine when the numbers are real and the trend matters. Give the most important number more space than the rest. |
| Section labels in small caps with wide tracking above every heading ("FEATURES", "PRICING") | Eyebrow labels as decoration | Use an eyebrow only where the section genuinely needs naming. Otherwise let the heading do the work. |

## The short version

1. One flat accent, used decisively. No gradients.
2. Depth from a few real surfaces. Glass only where something floats.
3. Generous space and radius, but a scale, not one value everywhere.
4. Content first: real-looking data, specific copy, layout shaped by what is in it.
5. Every interactive element has hover, active, focus-visible, disabled.
6. Motion is slow and calm, bounces on arrival, leaves quickly.
7. Dark mode is designed, not inverted.
