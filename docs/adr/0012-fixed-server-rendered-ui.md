# ADR 0012: Fixed Server-Rendered UI (Layout, Theming, Diff View)

## Status

Accepted

## Context

StoryShelf needs a web UI for three audiences: developers (builds, review), designers/managers (published Storybook, review), and admins (projects, members, tokens, settings). The UI must be self-hostable and rebrandable (logo + theme) without a build step, and it must keep the build review page — the core surface — image-first.

Options considered: a client framework (React/Vue/Svelte) with a UI build step; a fully pluggable UI adapter; or a fixed server-rendered UI. The precedent (StoryBooker) used `hono/jsx` + HTMX with a `UIAdapter` that was, in practice, a single fixed implementation exposing brand options.

## Decision

A **fixed, server-rendered UI** — `hono/jsx` + HTMX + `hono/css`. No client framework, no UI build step, no UI adapter. Custom interfaces are built against `/api/v1` (the same contract the CLI already speaks, so it cannot drift into a second-class citizen).

### Layout: header + sidebar

- **Top header (branded):** logo + name on the left; project/branch context; theme toggle; user menu. The accent color + logo are the "brand moment" (PocketBase-style).
- **Left sidebar (neutral):** project navigation — Builds, Storybook (published), Settings (members, tokens, webhooks, public access).
- **Content (monochrome, image-first):** neutral surfaces so screenshots and diffs dominate.

### Theming: system theme with manual override

- Follows the OS theme via `prefers-color-scheme`.
- Manual override: light / dark / system, persisted in a cookie so the server renders the correct theme class on first paint (no flash).
- Theming is driven by a `BrandTheme` token set (accent, surface, text, border, status colors) with light and dark variants, implemented in `hono/css`.

### Brand config

`ui: { name, logo, favicon, theme }` passed to `createShelfRouter` (see `ShelfOptions` in ADR 0001). Env vars (`SS_BRAND_NAME`, `SS_LOGO_URL`) supply defaults so self-hosters can rebrand with a `docker run`, no code.

### Diff view: simple three-up grid (v1)

The review page shows each changed/new story as a **three-up grid** — baseline | current | diff overlay — with approve/reject controls and the comment thread. The wipe slider, zoom, and other interactive diff niceties are **deferred**. A minimal vanilla-JS layer covers only the theme toggle and keyboard approve/reject; everything else is pure HTMX.

## Consequences

**Positive:**
- Rebranding is a config change (accent + logo), not a fork
- Image-first layout suits visual review; status color is the visual language
- No client framework or build step keeps the deployment single-artifact and air-gapped-friendly (HTMX vendored locally)
- The simple diff view ships fast; the rich diff interactions can be added later without re-architecting

**Negative:**
- The three-up grid is less fluid than a wipe slider for large screenshots; reviewers may want the slider sooner than expected
- A header + sidebar consumes more vertical/horizontal space than a single top bar on small screens
- Theme persistence via cookie is slightly more machinery than a pure client-side toggle

**Deferred (v2):** wipe slider + zoom, richer keyboard navigation, comment notifications, and any white-labeling beyond the `BrandTheme` tokens.
