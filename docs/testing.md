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

Runs the **real** capture pipeline (`@storyshelf/runner-playwright`) against a built Storybook fixture in `fixtures/storybook-8` (default, 7 stories). Fixtures for 8/9/10/11 each have independent `npm` installs and are built on demand (`npm ci && npm run build-storybook`; `storybook-static/` is `.gitignored`). Override with `FIXTURE_DIR=fixtures/storybook-9`. Requires Playwright browsers. Gated so `turbo test` stays browser-free.

## Fixtures

- `fixtures/storybook-8` — SB 8.6 Vite React (default, 7 stories; own npm install)
- `fixtures/storybook-9` — SB 9 Vite React
- `fixtures/storybook-10` — SB 10 ESM + CSF-Next (filters `subtype:'test'`)
- `fixtures/storybook-11` — SB 11 alpha (upcoming)
- All fixtures are deterministic (system fonts, no network) and share the same `Button` stories (including `play`/`flaky-test`/`disableSnapshot` variants). `storybook-static/` is built on demand, not committed.
- PNG fixtures for the diff engine.
- `index.json` fixtures for `discover()`.
