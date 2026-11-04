# Deployment

> Part of the [StoryShelf architecture spec](./README.md).

## Deployment

### Docker (recommended)

The Dockerfile and Compose file below are a sketch for a project of your own: `server.ts` is _your_ server entry, which calls `createShelfApp` the way `apps/fly-app/server.ts` and `apps/dev-server/src/server.ts` do (this repo has no root `server.ts`). The maintained image is `apps/fly-app/Dockerfile`: a rolldown bundle of `apps/fly-app/server.ts`, started with `node dist/server.mjs`, with `DATA_DIR=/data`.

```dockerfile
FROM mcr.microsoft.com/playwright:v1.63.0-noble
# Playwright image includes Chromium, Firefox, WebKit + system deps

WORKDIR /app
COPY package.json nub.lock ./
RUN nubx nub install --frozen-lockfile
COPY . .
RUN nubx nub run build

EXPOSE 3000
VOLUME /app/data

CMD ["node", "server.ts"]
```

```yaml
# docker-compose.yml
services:
  storyshelf:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - storyshelf-data:/app/data
    environment:
      - SECRET=your-hmac-secret-here
      # Where the database and storage live: must be the mounted volume. The servers in this
      # repo default elsewhere (`/data` in apps/fly-app, `.dev-data` in apps/dev-server).
      - DATA_DIR=/app/data
      # Capture + retention (read by apps/fly-app/server.ts)
      - CAPTURE_CONCURRENCY=2
      - PURGE_TTL_DAYS=30
      # Auth (optional — omit for no auth; see /guides/auth/)
      # - AUTH_PASSWORD=a-long-admin-password   # ≥ 12 chars (local admin)
      # SECRET must be ≥ 32 chars (e.g. openssl rand -hex 32)
      # Bootstrap (optional — first site admin before any user exists):
      # - STORYSHELF_ADMIN_TOKEN=your-long-random-token  # or ADMIN_TOKEN
      #   `SECRET` signs sessions; `STORYSHELF_ADMIN_TOKEN` grants site-admin
      #   API access (project creation, purge). Never the same value.

volumes:
  storyshelf-data:
```

The environment variables above are the ones `apps/fly-app/server.ts` reads (`SECRET`, `DATA_DIR`, `AUTH_PASSWORD`, `STORYSHELF_ADMIN_TOKEN`/`ADMIN_TOKEN`, `CAPTURE_CONCURRENCY`, `PURGE_TTL_DAYS`, `PORT`, `PUBLIC_BASE_URL`); `apps/dev-server` reads the same minus `CAPTURE_CONCURRENCY`, and the runners themselves fall back to `STORYSHELF_CAPTURE_CONCURRENCY`. The branch cleanup interval and TTL, and the published-Storybook subdomain domain, are `ShelfConfig` fields (`branchTtlDays`, `branchGcIntervalMs`, `publishedBaseDomain` in `core/src/config.ts`) that you set in your server's code: neither shipped server reads an environment variable for them. SSO providers are code-driven recipes, not environment variables; only a `{env:NAME}` reference inside the auth config resolves (see `/guides/auth/oidc`).

Capture runs **in-process** on the server using the image's own Playwright browsers — no Docker socket mount, no repo cloning.

### Development

```sh
nubx nub install
nubx nub run dev          # starts Hono dev server
```
