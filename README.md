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
  git-github/     @storyshelf/git-github    — GitHub commit status / merge gate / PR comments
  git-gitlab/     @storyshelf/git-gitlab    — GitLab commit status / merge gate / MR comments
  queue-sqs/      @storyshelf/queue-sqs     — AWS SQS capture job queue
  cli/            @storyshelf/cli           — CLI client (server init, init, create, upload, purge, retry)
   runner-playwright/ @storyshelf/runner-playwright — Playwright capture runner
  apps/
    dev-server/     dev-server      — local dev server (from TS source via nub watch)
    website/        website         — public docs (Astro Starlight)
    fly-app/        fly-app         — Fly demo (local adapters, workspace deps, multi-stage cached Dockerfile; deploys on tag via fly.yml)
  fixtures/
    storybook-8/    storybook-fixture -- SB 8.6 Vite React (default, 7 stories; own npm install)
    storybook-9/    storybook-fixture -- SB 9 Vite React
    storybook-10/   storybook-fixture -- SB 10 ESM + CSF-Next (filters subtype:'test')
    storybook-11/   storybook-fixture -- SB 11 alpha (upcoming)
  docs/                                       — architecture, ADRs, testing, website plan
```

## Commands

```sh
nub install                      # install workspace deps
nub run build                    # turbo build all packages
nub run test                     # turbo test
nub run verify                   # build + lint + test
```

## Getting started

```sh
npx @storyshelf/cli server init  # scaffold a server project
cd my-storyshelf
npm install
npm start                        # start the server
```

## Documentation

- Each package ships a `README.md` covering its use case, install, API, and an example.
- `apps/website/` hosts the public docs site (Astro Starlight): getting-started, CI, deployment, auth, and concept guides.
- `docs/architecture.md` is the full architecture spec; `docs/adr/` records design decisions; `docs/implementation-plan.md` is the build order.
