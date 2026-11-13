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
      # Behind a load balancer: the proxies allowed to name the client (see "Behind a proxy").
      - TRUST_PROXY=1

volumes:
  storyshelf-data:
```

The variables above are read by `apps/fly-app/server.ts`, which also reads `DATA_DIR`, `PORT`, `PUBLIC_BASE_URL`, `AUTH_PASSWORD`, `ADMIN_TOKEN` and the sign-in page branding. The branch cleanup interval and TTL, and the published-Storybook subdomain domain, are `ShelfConfig` fields (`branchTtlDays`, `branchGcIntervalMs`, `publishedBaseDomain` in `core/src/config.ts`) that you set in your server's code: neither shipped server reads an environment variable for them. SSO providers are code-driven recipes, not environment variables; only a `{env:NAME}` reference inside the auth config resolves (see `/guides/auth/oidc`).

### Behind a proxy

Rate limits (`/api/v1/*`, sign-in, the signed Storybook routes) count per client IP. By default that is the socket peer, so behind a load balancer every user shares the proxy's buckets, and one client can use up sign-in for all. `ShelfConfig.trustProxy` names the proxies that may report the client; both shipped servers map it from `TRUST_PROXY` (`parseTrustProxy` in `core/src/config.ts`):

| `TRUST_PROXY`               | Client IP                                                                                       | Use on                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| unset, `false`, `0`         | the socket peer (no forwarded header is read)                                                   | a server clients reach directly                                                                 |
| `1`, `2`, …                 | `X-Forwarded-For`, counting that many hops from the right                                       | one load balancer (`1`): ECS behind an ALB, Cloud Run, Azure Container Apps                     |
| `10.0.0.0/16,2001:db8::/32` | `X-Forwarded-For`, read only when the peer is in the list; the rightmost entry outside the list | proxies with known addresses                                                                    |
| `fly`                       | `Fly-Client-IP`                                                                                 | Fly.io (`apps/fly-app/server.ts` uses it when `FLY_APP_NAME` is set and `TRUST_PROXY` is unset) |

One resolver (`createClientIpResolver`, `app/src/middleware/client-ip.ts`) serves every rate-limit bucket. A forwarded header from a peer that is not trusted is never read, and an entry that is not an IP never names a client. Count only the proxies you run: a count higher than the real chain lets a client pick its own bucket by sending `X-Forwarded-For`. Limits stay per process.

### Development

```sh
nub ci              # install workspace dependencies
nub run serve       # dev server from TypeScript source on :3000, data in .dev-data/
```
