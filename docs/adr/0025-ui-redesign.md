# ADR 0025: UI Redesign — Shell, Review Workspace, Derived Brand Tokens

## Status

Accepted. Refines ADR 0012 (layout and theming details); the fixed, server-rendered
`hono/jsx` + HTMX + `hono/css` approach is unchanged.

## Context

The original shell (solid brand-colored top bar, flat text sidebar, three equal image
panes, tab bars) worked but read as dated, hid the review workflow behind small controls,
and let a customer's accent color flood the chrome — fine for blue, harmful for a
customer palette that is not designed to carry that much surface. The review page, the
product's core surface, offered no way to compare screenshots other than three static
panes.

## Decision

1. **Neutral chrome, derived accent.** The top bar is translucent and neutral. The
   customer's accent appears subtly: brand mark, active navigation, primary actions,
   focus, and tints computed with `color-mix` (`--accent-subtle/-wash/-border/-fg`,
   `--status-*-bg/-border/-fg`). `BrandTheme` gained no required fields;
   `topbarBg` is deprecated (parsed, ignored). Default text colors meet WCAG AA, and
   status badge text is derived toward the primary text color so tinted pills stay legible.
2. **Shell:** full-height icon sidebar (collapsible to a rail, cookie-persisted and applied
   in `<head>` to avoid a flash; off-canvas drawer on phones), a slim top bar with project
   switcher, theme menu and account menu, a toast region, and a `bare` layout for sign-in.
3. **Icons:** typed TS data → one SVG sprite served from the router at a content-hashed,
   `immutable` URL with ETag/304 (`/assets/icons-<hash>.svg`); `<Icon>` references it with
   `<use>`. The same content-hash scheme now serves HTMX (the previous unversioned
   `immutable` URL could be served stale after an upgrade).
4. **Review workspace:** `CompareStage` (side-by-side, swipe, onion skin, diff, flip, zoom,
   synced scroll), a thumbnail filmstrip with a CSS-driven filter, review progress, a sticky
   action bar, keyboard shortcuts (`j/k a/r 1–5 f t ?`) and **auto-advance** to the next open
   snapshot — server-side via `HX-Redirect`, only for decisions made on the review page
   (`HX-Current-URL`), so API and build-overview behavior are unchanged.
5. **Client script is idempotent.** HTMX `body` swaps re-execute inline scripts; document-level
   listeners bind once (`window.__ssInit`) and per-render wiring re-runs. Toasts for
   navigating responses are queued in `sessionStorage` (`data-toast`).
6. **Constraints kept:** no client framework, no UI adapter, system font stack, facade-only
   pages enforced by the ratchet test. The command palette was deferred.

## Consequences

- Customers see their accent in fewer, more deliberate places; palettes that looked wrong as
  a full-width bar now work.
- More primitives to maintain (`Icon`, `Table`, `CompareStage`, …) but pages shrink and share
  one visual language; the ratchet now also bans `table-wrap`/`login` raw classes.
- The icon sprite and htmx become cache-forever assets; changing either changes their URL.
- Follow-ups: `⌘K` palette; moving `profile` forms onto `SubNavLayout`; a docs-site
  screenshot refresh once the redesign ships.
