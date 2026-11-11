# Deployment

> Part of the [StoryShelf architecture spec](./README.md).

## Deployment

### Docker

The server is one container. Capture runs **in-process** with the image's own Chromium: no Docker socket mount, no repository cloning. Its only state is the data directory (`DATA_DIR`, `/data` in the image).

The image is built from `apps/fly-app/Dockerfile`, a rolldown bundle of `apps/fly-app/server.ts` started with `node dist/server.mjs`. The build context must be the repository root. The official image (#887) and the cloud modules (ADR 0050) are coming; until then, build from this Dockerfile.

```sh
docker build -f apps/fly-app/Dockerfile -t storyshelf .
docker run -p 3000:3000 \
  -v storyshelf-data:/data \
  -e SECRET=your-hmac-secret-of-at-least-32-chars \
  storyshelf
```

```yaml
# docker-compose.yml
services:
  storyshelf:
    build:
      context: .
      dockerfile: apps/fly-app/Dockerfile
    ports:
      - "3000:3000"
    volumes:
      - storyshelf-data:/data
    environment:
      # Signs sessions. Keep it stable across restarts.
      - SECRET=your-hmac-secret-of-at-least-32-chars
      # Site-admin API access (project creation, purge). Never the same value as SECRET.
      - STORYSHELF_ADMIN_TOKEN=your-long-random-token
      # Optional: a daily purge of finished builds older than 30 days. Unset means no purge.
      - PURGE_TTL_DAYS=30
      # Optional: concurrent captures on this instance.
      - CAPTURE_CONCURRENCY=2

volumes:
  storyshelf-data:
```

The variables above are read by `apps/fly-app/server.ts`, which also reads `DATA_DIR`, `PORT`, `PUBLIC_BASE_URL`, `AUTH_PASSWORD`, `ADMIN_TOKEN` and the sign-in page branding. The branch cleanup interval and TTL, and the published-Storybook subdomain domain, are `ShelfConfig` fields (`branchTtlDays`, `branchGcIntervalMs`, `publishedBaseDomain` in `core/src/config.ts`) that you set in your server's code: neither shipped server reads an environment variable for them. SSO providers are code-driven recipes, not environment variables; only a `{env:NAME}` reference inside the auth config resolves (see `/guides/auth/oidc`).

### Development

```sh
nub ci              # install workspace dependencies
nub run serve       # dev server from TypeScript source on :3000, data in .dev-data/
```
