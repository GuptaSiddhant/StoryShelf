# Public Website, Docs & Examples

## Website (Astro Starlight)

The public site lives in `website/` (top-level, not a `packages/` member) and is built with **Astro Starlight** — MDX, no React, fast builds, built-in search (Pagefind), dark mode, and i18n. (StoryBooker used Docusaurus; Starlight was chosen for its lighter footprint.)

- **Homepage:** the "self-hosted Chromatic alternative" pitch.
- **Guides:** Getting started; CI (GitHub Actions, GitLab CI); Deployment (Docker/docker-compose, reverse proxy, subdomains + wildcard TLS); Auth (OIDC, shared password, none); Monorepo (one project per Storybook); Retention & labels; Migrating from Chromatic.
- **API reference:** generated from the Hono `OpenAPIHono` spec — the `openapi` script copies `packages/core/dist/openapi.json` into the site and renders it with the `starlight-openapi` plugin (same trick StoryBooker used with Docusaurus).
- The internal `docs/` (architecture + ADRs) remains engineering-facing; the site is curated user guides.

## Examples

Top-level `examples/` (not turbo packages):

- **`examples/storybook`** — a minimal deterministic component library; its committed `storybook-static/` doubles as the capture test fixture and the "try it" sample.
- **`examples/fly-app`** — deploys StoryShelf to fly.io as a public demo: a `fly.toml` + Dockerfile running the server, a persistent Fly volume for `--data-dir` (SQLite + screenshots), seeded with the `examples/storybook` project. Fly's `*.fly.dev` wildcard certs mean `publishedBaseDomain` subdomains work on the demo.
- CI workflow examples (`github-actions.yml`, `.gitlab-ci.yml`) are shown inline in the guides rather than shipped as runnable repos.
