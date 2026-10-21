# ADR 0012: Server-Rendered UI

## Status

Accepted

Supersedes (archived): ADR 0012, 0025

## Context

StoryShelf needs a web UI for three audiences: developers (builds, review), designers and managers
(published Storybook, library, review) and admins (projects, members, tokens, settings). The UI must be
self-hostable and rebrandable (logo and theme) without a build step, and must keep the review page, the
core surface, image-first. A customer's accent color must not flood the chrome: palettes that are not
designed to carry a full-width bar looked wrong when used as one.

Options considered: a client framework (React, Vue, Svelte) with a UI build step; a fully pluggable UI
adapter; a fixed server-rendered UI. A UI adapter was, in practice, a single fixed implementation
exposing brand options.

## Decision

### 1. A fixed, server-rendered UI

`hono/jsx` + HTMX + `hono/css`. No client framework, no UI build step, no UI adapter, system font
stack. Custom interfaces are built against `/api/v1`, the same contract the CLI speaks, so it cannot
become a second-class citizen. HTMX is vendored locally, which keeps the deployment single-artifact and
air-gapped friendly.

### 2. Shell

- A full-height icon sidebar, collapsible to a rail (state persisted in a cookie and applied in
  `<head>` to avoid a flash), an off-canvas drawer on phones. Its footer holds the account, theme and
  collapse controls. Project navigation lives here: library, builds, review, settings.
- A slim, translucent, neutral top bar that is the project picker plus breadcrumbs (ancestors of the
  current page, derived from `nav`; the page's own heading is not repeated).
- A toast region, and a `bare` layout for sign-in.
- Content surfaces are neutral and monochrome so screenshots and diffs dominate. Color is reserved for
  accent actions and status badges and dots.

### 3. Theming: system theme, manual override, derived brand tokens

- The theme follows the OS through `prefers-color-scheme`. A manual override (light, dark, system) is
  persisted in a cookie so the server renders the right theme class on first paint, with no flash.
- Brand config is `ui: { name, logo, favicon, theme }` passed to `createShelfApp`. Environment
  variables (`SS_BRAND_NAME`, `SS_LOGO_URL`) supply defaults so self-hosters can rebrand with a
  `docker run` and no code.
- `BrandTheme` is a token set (accent, surface, text, border, status colors) with light and dark
  variants. Optional fields (`accentContrast`, `ring`, `surface.subtle`, `text.muted`, `borderSubtle`,
  `radius`, `radiusSm`, `shadow`) have fallbacks, so minimal configs validate.
- The customer's accent appears subtly: brand mark, active navigation, primary actions, focus, and
  tints computed with `color-mix` (`--accent-subtle`, `-wash`, `-border`, `-fg`, and
  `--status-*-bg/-border/-fg`). Default text colors meet WCAG AA, and status badge text is derived
  toward the primary text color so tinted pills stay legible.

### 4. Icons

Typed TS data becomes one SVG sprite served from the router at a content-hashed, `immutable` URL with
ETag and 304 (`/assets/icons-<hash>.svg`). `<Icon>` references it with `<use>`. HTMX is served with the
same content-hash scheme, so neither can be served stale after an upgrade; changing either changes its
URL.

### 5. Pages are built from the catalog, in both modes

The library, component and build pages are built from the build's Storybook catalog (`index.json`),
whether or not `testing` is on (ADR 0010 Projects, Published Storybook and Labels). The UI layers
testing data (thumbnails, statuses, diffs, health, attempts) onto those pages when `testing` is on. The
navigation, and the sections of pages that exist in both modes, follow the route classes of ADR 0006
(Testing Option, Hosting-Only Mode and the Database Queue): a section that needs `testing` is absent
without it, not disabled. An accepted build with no attempts is labelled "Published".

### 6. Review section

The build page has a review section (ADR 0013 UI Review) shown when the project's review setting is on,
with or without `testing`: build and story comments, the build-level verdict, and the changeset computed
from the catalog. Snapshot-level review lives in the review workspace below and exists only with
`testing`. Component pages list the comments of the build they show.

### 7. Review workspace (with `testing`)

The review page is the core surface and is image-first.

- `CompareStage`: side-by-side, swipe, onion skin, diff, flip and zoom, with synced scroll.
- A thumbnail filmstrip with a CSS-driven filter, and review progress.
- A sticky action bar with approve and reject, plus the comment thread.
- Keyboard shortcuts: `j/k` navigate, `a/r` approve and reject, `1-5` view modes, `f`, `t`, `?`.
- Auto-advance to the next open snapshot, server-side through `HX-Redirect`, only for decisions made on
  the review page (detected with `HX-Current-URL`), so API and build-overview behavior are unchanged.

### 8. Client script

A small vanilla-JS layer (theme, sidebar, dropdown, toast, review comparison and keyboard) is the only
client code. It is idempotent: HTMX `body` swaps re-execute inline scripts, so document-level listeners
bind once (`window.__ssInit`) and per-render wiring re-runs. Success toasts are server-decided: handlers
call `flash()`, which sets a short-lived cookie the shell turns into a toast on the next render (HTMX
redirect, swap or plain post). Review actions keep an optimistic client toast (`data-toast`). Validation
responses (400, 409, 422) are swapped by the shell along with their collected stylesheet.

### 9. Building blocks are strict

Pages compose facade components from `app/src/ui/components.tsx` (`Button`, `Tabs`, `Badge`, `Alert`,
`EmptyState`, `Stat`, `Field`, `Card`, `PageHeader`, `HStack`, `VStack`, `Table`, `Icon`, ...). Pages
never use raw `btn`, `tabs` or `card` classes, never `style="..."`, and never import component
families directly. Component styles are colocated through `hono/css` imported from `app/src/ui/css.ts`,
with readable `ss-<label>-<hash>` names and one `<style id="storyshelf-css">` mounted in
`DocumentLayout`. `app/src/ui/consistency.test.ts` is the ratchet, with zero tolerance on classes,
imports and inline styles. The `ui-building-blocks` skill is the working guide.

## Consequences

**Positive**

- Rebranding is a config change (accent and logo), not a fork.
- Customers see their accent in few, deliberate places, so palettes that look wrong as a full-width bar
  work.
- No client framework or build step; the UI is one deployable artifact.
- Hosting-only and testing deployments share one set of pages, with testing data layered on.
- Pages shrink and share one visual language.

**Negative**

- More primitives to maintain (`Icon`, `Table`, `CompareStage`, ...).
- The icon sprite and HTMX are cache-forever assets, so changing either changes its URL.
- A sidebar plus top bar uses more space than a single top bar on small screens, mitigated by the rail
  and the phone drawer.
- Cookie-persisted theme and sidebar state is more machinery than a pure client-side toggle.
- Server-rendered review is less fluid than a client app for very large screenshot sets.

## Alternatives considered

- **A client framework with a UI build step.** Rejected: breaks the single-artifact, no-build
  deployment.
- **A pluggable UI adapter.** Rejected: custom UIs consume `/api/v1` instead.
- **A solid brand-colored top bar.** Rejected: floods the chrome with the customer's palette.

## Open questions

- A `Cmd+K` command palette is deferred.
- Moving the `profile` forms onto `SubNavLayout`.
- A docs-site screenshot refresh once the redesign ships.
- Notifications for comments are specified in ADR 0014 (Git Hosts and Notifications), not here.
