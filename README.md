# StoryShelf

Self-hosted visual testing platform for Storybook. Run visual regression tests in CI, review pixel-level diffs in a web UI, and approve changes before they ship.

**Self-hosted Chromatic alternative. Storybook-native. Unlimited snapshots.**

## Layout

```
packages/
  core/           @storyshelf/core          — Hono router, models, capture pipeline, diff, retention
  db-sqlite/      @storyshelf/db-sqlite      — SQLite database adapter (better-sqlite3 + Drizzle)
  db-turso/       @storyshelf/db-turso       — Turso/libSQL database adapter
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
nub run serve                    # dev server from TS source, hot-restarts on any change
nub run build                    # turbo build all packages
nub run test                     # turbo test
nub run verify                   # build + lint + test
```

`nub run serve` runs the CLI from source (`nub watch ./packages/cli/src/index.ts serve --data-dir .dev-data`). It needs no build step: the `development` exports condition (via `nub.jsonc` + tsconfig `customConditions`) resolves workspace packages to their TypeScript source, and `nub watch` restarts the server whenever any file in the import graph changes.
