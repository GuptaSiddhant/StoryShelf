# Public Website, Docs & Examples

## Website (Astro Starlight)

The public site lives in `apps/website/` and is built with **Astro Starlight** — MDX, no React, fast builds, built-in search (Pagefind), dark mode, and i18n. (StoryBooker used Docusaurus; Starlight was chosen for its lighter footprint.)

- **Homepage:** the "self-hosted Chromatic alternative" pitch.
- **Guides:** Getting started; CI (GitHub Actions, GitLab CI); Deployment (Docker/docker-compose, reverse proxy, subdomains + wildcard TLS); Auth (OIDC, shared password, none); Monorepo (one project per Storybook); Retention & labels; Migrating from Chromatic.
- **API reference:** generated from the Hono `OpenAPIHono` spec — the `openapi` script runs `packages/core/scripts/generate-openapi.ts` → `apps/website/public/openapi.json` (prebuild). The site serves the static spec at `/openapi.json` and a client-side Swagger UI at `/openapi/` (CDN, read-only, no try-it) loading that spec.
- The internal `docs/` (architecture + ADRs) remains engineering-facing; the site is curated user guides.

## Examples & Fixtures

`fixtures/` (outside workspaces, independent `npm` installs) holds Storybook fixtures for each supported major:

- **`fixtures/storybook-8`** — SB 8.6 Vite React (default, 7 stories)
- **`fixtures/storybook-9`** — SB 9 Vite React
- **`fixtures/storybook-10`** — SB 10 ESM + CSF-Next (filters `subtype:'test'`)
- **`fixtures/storybook-11`** — SB 11 alpha (upcoming)

Each has its own `package.json`/`package-lock.json` and is built on demand (`npm ci && npm run build-storybook`); `storybook-static/` is `.gitignored`. `apps/fly-app` deploys StoryShelf to fly.io as a public demo: a `fly.toml` + Dockerfile running the server, a persistent Fly volume for `--data-dir` (SQLite + screenshots), seeded with the `fixtures/storybook-8` project. Fly's `*.fly.dev` wildcard certs mean `publishedBaseDomain` subdomains work on the demo.
- CI workflow examples (`github-actions.yml`, `.gitlab-ci.yml`) are shown inline in the guides rather than shipped as runnable repos.
