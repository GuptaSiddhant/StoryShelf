---
name: ui-building-blocks
description: Build or migrate server-rendered UI with strict facade components and colocated hono/css styles; use when adding UI variants, touching pages under packages/app/src/pages, styling components under packages/app/src/ui, or reviewing UI consistency
license: MIT
compatibility: opencode
metadata:
  audience: maintainers
  scope: packages/app/src/ui, packages/app/src/pages
---

# UI Building Blocks — Facade Components + Colocated hono/css

Pages compose; families own their styles. No raw classes, no inline styles, no
direct family imports in `pages/`. `app/src/ui/consistency.test.ts` enforces
this — keep it green and lower its per-file style ceilings as you migrate.

## The contract

- **Pages** (`pages/*.tsx`) may import UI only from the facade
  (`../ui/components.tsx`: `Button`, `Tabs`, `Badge`, `Alert`, `EmptyState`,
  `Stat`, `Field`, `TextareaField`, `SelectField`, `CheckField`, `Card`,
  `CardSection`, `PageHeader`, `SectionTitle`, `TableActions`, `Meta`) and
  the shell (`../ui/document.tsx`: `DocumentLayout`), plus shared
  cross-page style objects (`../ui/styles/review.ts`: diff viewer/nav,
  snapshot cards, comment threads) and `../ui/css.ts` (page-local one-off
  styles only — last resort after facade, utilities, and restructuring).
  Never import a family module (`buttons.tsx`, `feedback.tsx`, …) directly.
- **Shared cross-page patterns are the one colocation exception.**
  `snapshot-card` (build detail + library) and `comment` (build detail +
  diff thread) are used by two pages each — they live once as labeled
  hono/css objects in `ui/styles/review.ts`, imported by class object
  (never by string name). Single-page patterns colocate in their file.
- **No raw classes in pages:** `class="btn…"`, `class="tabs…"`,
  `tabs__link`, hand-rolled `page-header`/`card`/`empty` markup are banned —
  use the facade component with `variant`/`size`/`tone` props instead.
- **No `style="…"` in pages.** If a layout recurs, add a block component
  (`Stack`, `Row`, `TableActions`, `SectionTitle`) to the facade; one-off
  spacing is a design smell, not an exception.
- **Sanctioned utilities** (the only raw classes allowed in `pages/`):
  layout flow (`grid`, `grid--2/3`, `stack`, `row-actions`, `split`,
  `mt-1`, `mb-1`, `max-w-form`, `max-w-prose`, `max-w-cell`, `min-w-0`,
  `table-wrap`, `table-gap`, `nowrap` on `td`), text
  (`muted`, `mono`, `truncate`), shell (`content`, `login`). Everything
  else must be a facade component.
- **Table action cells** use `<td class="nowrap"><TableActions>` with
  `size="sm"` buttons; delete spacer spans and `display:inline` forms.
- **Page-local one-offs** (landing hero, truncate widths beyond
  `max-w-cell`) use `css` from `../ui/css.ts` with a label comment.
  If a pattern appears twice, promote it to the facade instead.
- **No documented exceptions.** The ratchet bans component classes,
  non-facade UI imports, and every inline `style="..."` in `pages/` with
  zero ceiling — the former root-hero exception was removed once the hero
  moved to page-local hono/css.
- **Inline/table/card actions use `size="sm"`** (32px). `md` (40px) is for
  standalone forms and page-header primary actions only.

## Styling with hono/css (via `ui/css.ts`, never `hono/css` directly)

`ui/css.ts` owns the single custom context (`<style id="storyshelf-css">`,
mounted in `DocumentLayout` right after the token `<style>` tag) with
`classNameSlug` producing readable `ss-<label>-<hash>` names.

- **One labeled template per variant.** Start each `css` template with a
  label comment (`/* btn-primary */`); it becomes the class-name prefix.
- **Compose via `${base}` extension, never `cx` for variants.** `cx`
  merges styles into a new *unlabeled* `css-<hash>` class and silently
  drops readability. Reserve `cx` for conditional plain strings only.
- **`&` nesting for pseudo-states** (`&:hover`, `&:disabled`) at the end of
  the template (native nesting; valid in all supported browsers).
- **Static values only.** Never interpolate runtime data — brand tokens
  stay CSS vars in the global token stylesheet. Interpolated values are
  raw CSS sinks (see hono css-helper security notes).
- **Thin wrappers, not re-exports.** `ui/css.ts` wraps `createCssContext`
  with publicly nameable types because `tsc` rejects direct re-exports
  under `declaration: true` (TS4023). Keep the wrappers; don't "simplify"
  them back to `export { css } from "hono/css"` (loses labels + breaks `tsc`).

## Gotchas this repo already hit

- **Never render CSS as a JSX text child** (`<style>{cssString}</style>`).
  Hono escapes text children (`"` → `&quot;`, `>` → `&gt;`), silently
  killing font stacks and every `[attr="…"]` selector. Global CSS goes
  through `dangerouslySetInnerHTML`; component CSS through hono/css `raw()`.
- **HTMX swaps discard `<head>`.** Mutations return full documents with
  `hx-target="body"`, so a class *first introduced by swapped content*
  relies on hono/css's fallback append-script. The component set is nearly
  identical across states, so this is safe — but verify with the
  `storyshelf-css` collection test in `ui/document.test.ts` when adding a
  conditionally-rendered variant.
- **No string surgery on rendered HTML.** The tokens-tab secret banner used
  `html.replace('<nav class="tabs"', …)` and broke the moment tabs were
  migrated. Pass data through `formState`/props instead.

## Verification (in order)

1. `nubx tsc --noEmit -p tsconfig.json` (from `packages/app/`)
2. `nub run lint` (from `packages/app/`)
3. `nub run test` — includes `ui/consistency.test.ts` (ratchet) and
   `ui/document.test.ts` (unescaped stylesheet + style collection)
4. `nub run build`
5. `nub packages/app/scripts/screenshots.mjs` (from repo root) when visuals
   change; eyeball the PNGs before committing
