# Public Website, Docs & Examples

## Website (Astro Starlight)

The public site lives in `website/` (top-level, not a `packages/` member) and is built with **Astro Starlight** — MDX, no React, fast builds, built-in search (Pagefind), dark mode, and i18n. (StoryBooker used Docusaurus; Starlight was chosen for its lighter footprint.)

- **Homepage:** the "self-hosted Chromatic alternative" pitch.
- **Guides:** Getting started; CI (GitHub Actions, GitLab CI); Deployment (Docker/docker-compose, reverse proxy, subdomains + wildcard TLS); Auth (OIDC, shared password, none); Monorepo (one project per Storybook); Retention & labels; Migrating from Chromatic.
- **API reference:** generated from the Hono `OpenAPIHono` spec — the `openapi` script runs `packages/core/scripts/generate-openapi.ts` → `website/public/openapi.json` (prebuild). The site serves the static spec at `/openapi.json` and a client-side Swagger UI at `/openapi/` (CDN, read-only, no try-it) loading that spec.
- The internal `docs/` (architecture + ADRs) remains engineering-facing; the site is curated user guides.

## Examples

Top-level `examples/` (not turbo packages) plus the `apps/storybook-fixture` app:

- **`apps/storybook-fixture`** — a minimal deterministic component library; its committed `storybook-static/` doubles as the capture test fixture and the "try it" sample.
- **`examples/fly-app`** — deploys StoryShelf to fly.io as a public demo: a `fly.toml` + Dockerfile running the server, a persistent Fly volume for `--data-dir` (SQLite + screenshots), seeded with the `apps/storybook-fixture` project. Fly's `*.fly.dev` wildcard certs mean `publishedBaseDomain` subdomains work on the demo.
- CI workflow examples (`github-actions.yml`, `.gitlab-ci.yml`) are shown inline in the guides rather than shipped as runnable repos.
