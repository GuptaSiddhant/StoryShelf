# StoryShelf

Self-hosted visual testing platform for Storybook. Run visual regression tests in CI, review pixel-level diffs in a web UI, and approve changes before they ship.

**Self-hosted Chromatic alternative. Storybook-native. Unlimited snapshots.**

## Layout

```
packages/
  core/           @storyshelf/core          — Hono router, models, capture pipeline, diff, retention
  sqlite/         @storyshelf/sqlite        — SQLite database adapter (better-sqlite3 + Drizzle)
  turso/          @storyshelf/turso         — Turso/libSQL database adapter
  storage-local/  @storyshelf/storage-local — local filesystem storage
  storage-s3/     @storyshelf/storage-s3    — S3-compatible storage
  auth-oauth/     @storyshelf/auth-oauth    — OIDC auth
  auth-password/  @storyshelf/auth-password — shared-password auth
  cli/            @storyshelf/cli           — CLI (serve, upload, init, purge, retry)
website/                                    — public docs (Astro Starlight)
examples/
  storybook/                                — deterministic capture fixture
  fly-app/                                  — fly.io demo
docs/                                       — architecture, ADRs, testing, website plan
```

## Commands

```sh
nub install                      # install workspace deps
nub run build                    # turbo build all packages
nub run test                     # turbo test
nub run verify                   # build + lint + test
nub run --filter @storyshelf/cli start   # run the server
```

See `docs/architecture.md` for the full architecture and `docs/implementation-plan.md` for the build order.
