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
  `CardSection`, `PageHeader`, `SectionTitle`, `Meta`, `HStack`, `VStack`,
  `Icon`, `Avatar`, `Kbd`, `Segmented`, `SubNavLayout`, `Table`,
  `Thumbnail`, `Dropdown`, `Progress`, `CompareStage`, `CodeBlock`,
  `FilterInput`, `RelativeTime`) and the shell (`../ui/document.tsx`:
  `DocumentLayout`), plus shared cross-page style objects
  (`../ui/styles/review.ts`: snapshot cards, comment threads;
  `../ui/styles/review-layout.ts`: review workspace layout) and
  `../ui/css.ts` (page-local one-off styles only — last resort after
  facade, utilities, and restructuring).
  Never import a family module (`buttons.tsx`, `feedback.tsx`, …) directly.
- **Shared cross-page patterns are the one colocation exception.**
  `snapshot-card` (build detail + library) and `comment` (build detail +
  diff thread) are used by two pages each — they live once as labeled
  hono/css objects in `ui/styles/review.ts`; the review workspace's
  header/filmstrip/action bar live in `ui/styles/review-layout.ts`. Import
  by class object (never by string name). Single-page patterns colocate in
  their file. The ratchet allows `styles/review(-[a-z]+)?.ts`.
- **No raw classes in pages:** `class="btn…"`, `class="tabs…"`,
  `tabs__link`, hand-rolled `page-header`/`card`/`empty` markup are banned —
  use the facade component with `variant`/`size`/`tone` props instead.
- **No `style="…"` in pages.** If a layout recurs, add a block component
  (`Stack`, `Row`, `TableActions`, `SectionTitle`) to the facade; one-off
  spacing is a design smell, not an exception.
- **Stack layout uses `HStack` / `VStack`, never utility divs or inline
  flex.** `HStack` (gap sm/md/lg, align center/start/end/baseline,
  justify start/center/end/between, wrap) and `VStack` (gap, align)
  render plain divs with token-map values (props select from finite maps —
  same trust as static CSS). Margins belong to flow context (`mt-1`/`mb-1`
  wrappers), never to the stack. There is exactly one row primitive;
  `TableActions` was folded into `HStack` and must not be reintroduced.
- **Sanctioned utilities** (the only raw classes allowed in `pages/`):
  spacing (`mt-1`, `mb-1`, `max-w-form`, `max-w-prose`, `max-w-cell`,
  `min-w-0`), grids (`grid`, `grid--2/3`, `nowrap` on `td`), text (`muted`,
  `mono`, `truncate`, `visually-hidden` for screen-reader-only labels).
  Tables go through `<Table>` (`table-wrap` and `login` are ratchet-banned).
  Everything else must be a facade component.
- **Page-local one-offs** (landing hero, truncate widths beyond
  `max-w-cell`) use `css` from `../ui/css.ts` with a label comment.
  If a pattern appears twice, promote it to the facade instead.
- **No documented exceptions.** The ratchet bans component classes,
  non-facade UI imports, and every inline `style="..."` in `pages/` with
  zero ceiling — the former root-hero exception was removed once the hero
  moved to page-local hono/css.
- **Inline/table/card actions use `size="sm"`** (32px). `md` (40px) is for
  standalone forms and page-header primary actions only.

## Icons, tokens, and the shell

- **Icons are sprite-backed.** Add the SVG body to `ui/icons/paths.ts`
  (24×24, stroke-based, inherits `currentColor`); `IconName` and the sprite
  update automatically. Render with `<Icon name="…" />` (decorative by
  default, pass `label` when it is the only content). The sprite is served
  at `/assets/icons-<hash>.svg` (immutable, ETag/304) — URLs come from
  `asset-manifest.ts`; never hand-write them.
- **Colors come from tokens, never literals.** Brand accent/status colors
  are customer-configurable, so derive tints with the shared tokens
  (`--accent-subtle`, `--accent-wash`, `--accent-border`, `--accent-fg`,
  `--status-*-bg|-border|-fg`) and use `--text-secondary` (not
  `--text-muted`, which is for decoration/placeholders) for small text.
  `styles.test.ts` enforces WCAG AA for the default themes.
- **Breadcrumbs belong to the shell, not `PageHeader`.** Pass `nav.trail`
  (`{ label, href? }[]`) to `DocumentLayout`, ending with the current
  page. The top bar renders `[project picker] › ancestors…` and *drops* the
  current page — its heading names it, so never show a title in both places
  (on phones only the parent shows, as `‹ Parent`, and the project picker shrinks to its icon, keeping its chevron when there are several projects). Account, theme and collapse live in the sidebar footer.
- **Chrome lives in `ui/shell/`** (`sidebar`, `topbar`, `bare`, boot and
  client scripts). `DocumentLayout` takes `layout="default" | "wide" |
  "bare"` (`bare` = sign-in/invite, no app chrome).
- **Review comparison:** swipe has a draggable `[data-compare-knob]` (pointer events + capture) mirrored into the `[data-compare-swipe]` range; zoom levels live in `ZOOMS` (`review-script.ts`) and `compare-stage.tsx` — keep them in sync, and keep zoomed images `image-rendering: pixelated`.
- **The client script runs once per document.** HTMX `body` swaps re-execute
  inline scripts, so `ui/shell/client-script.ts` guards on `window.__ssInit`:
  bind `document` listeners once (look elements up lazily), and put
  per-render wiring in `inits`. Never add `document.addEventListener` at
  the top level of a re-executed script.
- **Toasts come from the server.** On a successful mutation call
  `flash(c, "Saved")` (`routers/flash.ts`; `flashHx` for `/api/v1` routes so
  JSON clients get no cookie) *before* the redirect/response — never on
  validation failure. It sets a 60 s `storyshelf_flash` cookie that the
  shell script shows as a toast and clears, so it works for HTMX redirects,
  in-place swaps, and plain form posts. `data-toast`/`data-toast-tone` on a
  form is the *optimistic* client variant, used only by review actions where
  an instant message matters more than server confirmation.
- **Forms.** Use `Field`/`TextareaField`/`SelectField`/`CheckField`,
  `FormActions` for the button row, `hx-confirm` (HTMX) or `data-confirm`
  (plain post) on destructive actions. Validation failures return the
  re-rendered page with status 400/409/422: the shell swaps these (HTMX
  normally ignores 4xx) and adopts the response's collected stylesheet, so
  new classes on the error page are styled. Every tab must render
  `formState.globalError`, or its errors are invisible.

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
5. Run the app against seeded data and look at it (light + dark, 375px and
   desktop). Optionally audit with axe-core — the redesign shipped with zero
   violations across the main pages in both themes.
6. `nub run screenshots` (repo root; `screenshots:app` / `screenshots:og` for
   one half) when docs screenshots (light + dark, in `apps/website/src/assets/screenshots`) need refreshing; eyeball the PNGs before
   committing
