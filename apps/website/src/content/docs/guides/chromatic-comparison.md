---
title: Chromatic vs StoryShelf
description: Honest feature, pricing, and architecture comparison for teams evaluating visual testing tools.
---

This page compares Chromatic (SaaS) and StoryShelf (self-hosted) factually. No recommendations — choose based on your constraints.

## Quick comparison

| Aspect                    | Chromatic                                      | StoryShelf                                                                                   |
| ------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Pricing model**         | Per-snapshot billing                           | Free (self-hosted, unlimited)                                                                |
| **Hosting**               | SaaS only (Chromatic cloud)                    | Self-hosted (your infrastructure)                                                            |
| **Browsers**              | Chrome, Firefox, Safari, Edge (branded, cloud) | Chromium (default), Firefox, WebKit via Playwright (per-project `browser`)                   |
| **TurboSnap**             | Yes (dependency graph)                         | Yes — affected capture (dependency graph, on by default)                                     |
| **Modes / Globals**       | Yes                                            | Yes — `parameters.chromatic.modes` / `parameters.storyshelf.modes` ([Modes](/guides/modes/)) |
| **Accessibility testing** | Yes (aXe)                                      | axe-core checks (opt-in), reported as non-blocking annotations                               |
| **Interaction tests**     | Yes (`play` functions)                         | Yes (`play` functions)                                                                       |
| **SSO / Enterprise**      | Enterprise plan                                | Better Auth engine (OIDC/SAML via any IdP)                                                   |
| **Vendor lock-in**        | Yes (proprietary)                              | No (MIT, open source)                                                                        |
| **Data residency**        | US / EU regions                                | Your choice (your infra)                                                                     |
| **Parallelization**       | Automatic cloud                                | Manual (concurrency config)                                                                  |
| **Flake handling**        | Built-in                                       | `flakyTest` param + tags                                                                     |
| **Setup**                 | `npx chromatic`                                | `storyshelf server init` + CI config                                                         |

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

|                     | Chromatic                                                                  | StoryShelf                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Capture**         | Cloud browsers                                                             | Self-hosted on your infra: Playwright (Chromium/Firefox/WebKit) or lightweight Puppeteer (Chromium-only, chrome-headless-shell) |
| **Baselines**       | Global + branch                                                            | Per-branch with default-branch fallback                                                                                         |
| **Baseline lookup** | Traverses git ancestry to find ancestor builds; rebase/squash can break it | Key lookup on project/story/viewport/branch — no history walk, rebase- and squash-proof                                         |
| **Storage**         | Chromatic cloud                                                            | Your S3-compatible or local filesystem                                                                                          |
| **Database**        | Chromatic managed                                                          | Your SQLite/Turso/Postgres                                                                                                      |
| **Queue**           | Chromatic managed                                                          | In-memory / Redis / SQS (your choice)                                                                                           |
| **Auth**            | Chromatic accounts / SAML                                                  | Local / social / SSO / passkeys / none                                                                                          |

## Feature parity

### Parity

- Visual regression testing via pixel diff (pixelmatch)
- Storybook `play` function execution
- Per-story controls: `disableSnapshot`, `flakyTest`, `delay`, `diffThreshold`, `pauseAnimationAtEnd`
- Git provider status checks (GitHub, GitLab)
- PR/MR comments with diff links
- Branch-aware baselines
- CI integration (GitHub Actions, GitLab CI, etc.)

### StoryShelf gaps (vs Chromatic)

- **Cross-browser gaps** — Chromium (default), Firefox, and WebKit are selectable per project; list up to three with `PATCH /api/v1/projects/:slug` (`browsers`) to capture each build on every engine, with per-engine baselines. No branded Safari/Edge binaries.
- **Vite-only tracing** — affected capture reads `preview-stats.json` (plus tolerant Webpack shapes). TurboSnap-equivalent skip rates on Vite Storybooks; custom builders without stats fall back to full renders.
- **Modes differ slightly** — Mode values may only use characters Storybook's `globals` URL arg accepts; baselines are keyed by mode name as in Chromatic.
- **Accessibility results are annotations only** — Opt-in per project (`runA11y`); the runners inject axe-core into the story page and scan the story root with the WCAG A/AA rules (honouring `parameters.a11y`). Violations are listed per story in the attempt log and never fail or gate a build; there is no accessibility baseline, review workflow or accessibility snapshot billing.
- **No cloud parallelization** — Concurrency limited by your server resources (`capture.concurrency` option).
- **No built-in flake detection** — Relies on explicit `flakyTest` parameter/tags.

### StoryShelf advantages (vs Chromatic)

- **Unlimited snapshots** — No per-snapshot billing ever (so skipping saves server CPU, not money — there is no 0.2× copy charge because there is nothing to bill).
- **Full data control** — Your database, your storage, your network.
- **No vendor lock-in** — MIT licensed, open source, standard APIs.
- **Flexible SSO** — Any OIDC provider (Keycloak, Okta, Entra ID, Auth0, Cognito).
- **Self-hosted on any platform** — Node, Bun, Deno, Fly.io, Railway, Render, Vercel, Cloudflare Workers, AWS Lambda, etc.
- **Per-branch baselines with fallback** — Cleaner model for long-lived feature branches.

## Migration considerations

Coming from Lost Pixel instead? See the [Lost Pixel migration guide](/guides/lost-pixel-migration/).

If migrating from Chromatic:

| Item              | Notes                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Baselines**     | No export API in Chromatic. Requires re-acceptance on first StoryShelf run.                                                 |
| **Parameters**    | Dual-key support: `chromatic:` and `storyshelf:` keys both work; `storyshelf:` wins on conflict.                            |
| **TurboSnap**     | Not replicated. Expect 5-10× more snapshots initially.                                                                      |
| **Modes/Globals** | Supported — existing `parameters.chromatic.modes` work unchanged ([Modes](/guides/modes/)).                                 |
| **Cross-browser** | Chromium / Firefox / WebKit, up to 3 per project via `browsers` (per-engine baselines, sequential); no branded Safari/Edge. |
| **Team workflow** | Similar — PR status checks, review UI, approve/reject.                                                                      |

## When to choose each

**Choose Chromatic if:**

- You want zero infrastructure maintenance
- You need branded Safari/Edge binaries or multi-browser matrices in a single build
- You rely on TurboSnap's Webpack tracing for a non-Vite builder
- You need accessibility results as a reviewed, baselined gate rather than non-blocking annotations
- Your team prefers SaaS over self-hosting

**Choose StoryShelf if:**

- Snapshot costs are a concern (large Storybooks, frequent commits)
- Data residency / compliance requires self-hosting
- You want to avoid vendor lock-in
- You already run infrastructure (Kubernetes, VMs, serverless)
- You need flexible SSO with existing OIDC provider
- You're comfortable operating a Node.js service
