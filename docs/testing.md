# Testing Strategy

## Principles

- **Fast and hermetic by default.** `nub run test` (vitest) must never need a browser, network, or a Storybook build. Browser coverage is gated.
- **Constructor injection makes this possible.** Models take adapters in their constructor (ADR 0001), so unit tests pass in-memory SQLite (`:memory:`), a temp-dir storage, and fakes for capture/auth/status.
- **Assert behavior, not lines.** The 100%-coverage target (AGENTS.md) applies to models, routers, adapters, and the diff engine. The browser-integration path is asserted behaviorally.

## Layers

### 1. Unit (vitest, colocated `*.test.ts`, CI-always)

- **Models** — baseline resolution (per-branch fallback chain), accept/reject, purge candidate selection (terminal + TTL + keep-latest-per-branch + `persistent` exemption + orphan GC), labels (URL-safe values, latest-build resolution, `persistent` non-removable).
- **Diff engine** — committed fixture PNGs (identical, differing, size-changed) assert `diffPixels`/`diffRatio`/overlay bytes.
- **Routers/handlers** — Hono request/response against in-memory DB + fake storage; auth/role middleware with a mock `AuthAdapter`.
- **Capture `discover()` / `buildUrl()`** — parse a committed `index.json` fixture; URL-safety (encodeURI + wildcard value segment).
- **URL builder** — path vs subdomain forms, label/branch encoding.

### 2. Adapter contract tests

Each adapter against its interface: SQLite via `:memory:` (Turso via a local libSQL stub), storage-local via a temp dir, storage-s3 via a recorded/fake client, auth adapters with a mock provider.

### 3. Integration (vitest, CI-always)

`createShelfRouter({ database, storage, capture: <fake> })` drives the full `upload → capture → diff → review → approve` flow over HTTP. Capture is a fake runner here (a real one needs a browser).

### 4. Browser integration (gated: `nub run test:integration`)

- **Visual (all fixtures, matrix in CI):** Runs the real capture pipeline (`@storyshelf/runner-playwright`) against a built Storybook fixture in `fixtures/storybook-8` (default, 7 stories), `fixtures/storybook-9`, and `fixtures/storybook-10` (each independent `pnpm` install, built on demand `pnpm install && pnpm run build-storybook`; `storybook-static/` is `.gitignored`). Override locally with `FIXTURE_DIR=fixtures/storybook-9`. Requires Playwright browsers. Gated so `turbo test` stays browser-free.
- **Interaction (`play`, only oldest):** When a project has `executePlay: true`, the same suite runs `play` functions before screenshots. Tested only against `fixtures/storybook-8` (oldest) unless a major changes the `play` channel — then add a single `play` smoke for that major. Verified: `BlockingFailure` → whole build `failed`, `FlakyTag`/`FlakyParam` (`flaky-test`) → non-blocking `reviewing` with warning, `Disabled` (`skip`/`disableSnapshot`) → not counted.

## Fixtures

- `fixtures/storybook-8` — SB 8.6 Vite React (default, 7 stories; own pnpm install, `6008`)
- `fixtures/storybook-9` — SB 9 Vite React (`6009`, no `addon-essentials`, `features: {backgrounds,controls,viewport}`)
- `fixtures/storybook-10` — SB 10 ESM + CSF-Next (filters `subtype:'test'`, `6010`, `definePreview`/`preview.meta`/`meta.story` + `experimentalTestSyntax`)
- All fixtures are deterministic (system fonts, no network) and share the same `Button` stories (including `play`/`flaky-test`/`disableSnapshot`/`delay` variants). `storybook-static/` is built on demand, not committed.
- PNG fixtures for the diff engine.
- `index.json` fixtures for `discover()`.
