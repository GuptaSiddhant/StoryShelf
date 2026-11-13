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

### CDN in front of published builds

Published Storybook files can sit behind a CDN. What a CDN may keep is decided by the `Cache-Control` each answer carries, which the server sets per request. A CDN must obey it: do not add a default TTL, do not override `private`, and do not cache by URL when the response is `private`.

| Route | Who gets it | `Cache-Control` | A shared cache (CDN) may store it |
| --- | --- | --- | --- |
| `/_/<buildId>/*` (a ULID short link) | a public build, or any build on an instance without sign-in | `public, max-age=31536000, immutable` | yes, indefinitely |
| `/projects/:slug/storybook/build/<buildId>/*` | the same | `public, max-age=31536000, immutable` | yes, indefinitely |
| `/_/<slug>/` (the project's latest build) | the same | `public, max-age=60` | yes, for a minute |
| `/_/<slug>/*` (a slug, not the root) | the same | `public, max-age=3600` | yes, for an hour |
| a public build's Storybook landing page | the same | `public, no-cache` | revalidate only |
| a private build, signed-in viewer with a role | `session` | `private, no-cache` | no |
| `/_s/:token/*` (a signed URL) | the token holder | `private, no-store`; a capture grant may get `private, max-age=N` when `captureAssets.cacheMaxAgeSeconds` is set | no |
| `/_r/:token/*` (a read grant) | the token holder | `private, no-store` | no |

Rules for the CDN:

- **Public builds** are safe to cache for good: the build's URL names its content, so an entry never goes stale.
- **Private projects** must bypass the cache. Their answers are `private`, and a CDN that stores them would serve one viewer's private build to anyone who asks for the same URL.
- **`/_s/` and `/_r/` must bypass the cache.** They are signed, carry the token in the URL, and are `no-store` (a successful capture-grant answer may use `private`, never `public`).
- **Compression.** When `publishedCompression` is on, the answer varies by `Accept-Encoding`; the server sends `Vary: Accept-Encoding`, and the CDN must key its cache on it.
- **Never** add `public` or `s-maxage` to an answer the origin marked `private`. Authorization is decided at the origin, so a CDN that keeps a private answer serves it without the check.

A 404 for a private build is the same for every caller and carries no `Cache-Control`; configure the CDN not to cache 404s on these paths, so that a build published later appears at once.

### Running several instances

Several instances can share one database and one storage adapter. Some state is shared between them and some is per process; this decides what a configured limit means.

**Shared** (one copy, seen by every instance):

- the database, including the capture and publish job queue (`capture_jobs`): any instance may take a job, and a lease recovers work from an instance that stops;
- published files and manifests in the storage adapter;
- the AI token budget: usage is counted from the database, so the daily limit holds across instances;
- sessions and signed URLs, provided every instance has the same `SECRET`. Set it once and share it.

**Per process** (each instance has its own copy):

- the manifest cache (a bounded cache per storage adapter) and the catalog cache (`catalog.json` by build id): a cold instance reads storage once; the entries are immutable, so this never causes a stale answer;
- the rate-limit buckets: a client's count lives in the instance it reaches;
- the remote-browser connection limiter (`maxConnections`) and the render page limit;
- the capture consumer: each instance runs its own, so `CAPTURE_CONCURRENCY` applies per instance.

What this means for configured limits with N instances:

| Limit | Total across N instances |
| --- | --- |
| `/api/v1/*`, sign-in and signed-URL rate limits | up to N × the configured count for one client, when a load balancer spreads that client over instances |
| `CAPTURE_CONCURRENCY` | N × the value captures run at once; each capture drives a browser |
| remote-browser `maxConnections` | N × the value connections to a remote service; divide a provider's session limit by N |
| render pages per instance | N × the per-instance page limit |
| AI token budget | not multiplied: it is counted from the database |

Choose each per-instance value as the total limit divided by N. For rate limits, a load balancer that keeps one client on one instance (sticky sessions) keeps the count exact for that client.

### Development

```sh
nub ci              # install workspace dependencies
nub run serve       # dev server from TypeScript source on :3000, data in .dev-data/
```
