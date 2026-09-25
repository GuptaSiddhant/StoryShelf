---
title: Chromatic vs StoryShelf
description: Honest feature, pricing, and architecture comparison for teams evaluating visual testing tools.
---

This page compares Chromatic (SaaS) and StoryShelf (self-hosted) factually. No recommendations — choose based on your constraints.

## Quick comparison

| Aspect | Chromatic | StoryShelf |
|--------|-----------|------------|
| **Pricing model** | Per-snapshot billing | Free (self-hosted, unlimited) |
| **Hosting** | SaaS only (Chromatic cloud) | Self-hosted (your infrastructure) |
| **Browsers** | Chrome, Firefox, Safari, Edge (branded, cloud) | Chromium (default), Firefox, WebKit via Playwright (per-project `browser`) |
| **TurboSnap** | Yes (dependency graph) | Yes — affected capture (dependency graph, on by default) |
| **Modes / Globals** | Yes | Not implemented |
| **Accessibility testing** | Yes | Not implemented |
| **Interaction tests** | Yes (`play` functions) | Yes (`play` functions) |
| **SSO / Enterprise** | Enterprise plan | OIDC/OAuth (any provider) |
| **Vendor lock-in** | Yes (proprietary) | No (MIT, open source) |
| **Data residency** | US / EU regions | Your choice (your infra) |
| **Parallelization** | Automatic cloud | Manual (concurrency config) |
| **Flake handling** | Built-in | `flakyTest` param + tags |
| **Setup** | `npx chromatic` | `storyshelf server init` + CI config |

## Pricing detail

**Chromatic (2024 pricing):**
- Free: 5,000 billed snapshots/month
- Pro: $179/month for 35,000 billed snapshots
- Enterprise: Custom pricing

Billed snapshots = visual snapshots + accessibility snapshots. TurboSnap copies count as 0.2 billed snapshots each.

**StoryShelf:**
- $0 license (MIT)
- Infrastructure cost only (your servers, databases, object storage)
- Unlimited snapshots, projects, users

## Architecture differences

| | Chromatic | StoryShelf |
|--|-----------|------------|
| **Capture** | Cloud browsers | Self-hosted on your infra: Playwright (Chromium/Firefox/WebKit) or lightweight Puppeteer (Chromium-only, chrome-headless-shell) |
| **Baselines** | Global + branch | Per-branch with default-branch fallback |
| **Storage** | Chromatic cloud | Your S3-compatible or local filesystem |
| **Database** | Chromatic managed | Your SQLite/Turso/Postgres |
| **Queue** | Chromatic managed | In-memory / Redis / SQS (your choice) |
| **Auth** | Chromatic accounts / SAML | OIDC/OAuth / shared password / none |

## Feature parity

### Parity
- Visual regression testing via pixel diff (pixelmatch)
- Storybook `play` function execution
- Per-story controls: `disableSnapshot`, `flakyTest`, `delay`, `diffThreshold`
- Git provider status checks (GitHub, GitLab)
- PR/MR comments with diff links
- Branch-aware baselines
- CI integration (GitHub Actions, GitLab CI, etc.)

### StoryShelf gaps (vs Chromatic)
- **Cross-browser gaps** — Chromium (default), Firefox, and WebKit are selectable per project (Settings → General → Capture browser, or `PATCH /api/v1/projects/:slug` with `browser`); baselines track the browser. No branded Safari/Edge binaries; one browser per build.
- **Vite-only tracing** — affected capture reads `preview-stats.json` (plus tolerant Webpack shapes). TurboSnap-equivalent skip rates on Vite Storybooks; custom builders without stats fall back to full renders.
- **No Modes/Globals** — Cannot test stories under different themes, locales, or viewports via Storybook globals.
- **No accessibility testing** — No aXe integration.
- **No cloud parallelization** — Concurrency limited by your server resources (`captureConcurrency` config).
- **No built-in flake detection** — Relies on explicit `flakyTest` parameter/tags.

### StoryShelf advantages (vs Chromatic)
- **Unlimited snapshots** — No per-snapshot billing ever (so skipping saves server CPU, not money — there is no 0.2× copy charge because there is nothing to bill).
- **Full data control** — Your database, your storage, your network.
- **No vendor lock-in** — MIT licensed, open source, standard APIs.
- **Flexible SSO** — Any OIDC provider (Keycloak, Okta, Entra ID, Auth0, Cognito).
- **Self-hosted on any platform** — Node, Bun, Deno, Fly.io, Railway, Render, Vercel, Cloudflare Workers, AWS Lambda, etc.
- **Per-branch baselines with fallback** — Cleaner model for long-lived feature branches.

## Migration considerations

If migrating from Chromatic:

| Item | Notes |
|------|-------|
| **Baselines** | No export API in Chromatic. Requires re-acceptance on first StoryShelf run. |
| **Parameters** | Dual-key support: `chromatic:` and `storyshelf:` keys both work; `storyshelf:` wins on conflict. |
| **TurboSnap** | Not replicated. Expect 5-10× more snapshots initially. |
| **Modes/Globals** | Not supported. Theming/i18n test matrices need workarounds. |
| **Cross-browser** | Chromium / Firefox / WebKit per project (Settings or API); one browser per build; no branded Safari/Edge. |
| **Team workflow** | Similar — PR status checks, review UI, approve/reject. |

## When to choose each

**Choose Chromatic if:**
- You want zero infrastructure maintenance
- You need branded Safari/Edge binaries or multi-browser matrices in a single build
- You rely on TurboSnap's Webpack tracing for a non-Vite builder
- You need Modes/Globals for theme/locale matrices
- You need built-in accessibility testing
- Your team prefers SaaS over self-hosting

**Choose StoryShelf if:**
- Snapshot costs are a concern (large Storybooks, frequent commits)
- Data residency / compliance requires self-hosting
- You want to avoid vendor lock-in
- You already run infrastructure (Kubernetes, VMs, serverless)
- You need flexible SSO with existing OIDC provider
- You're comfortable operating a Node.js service