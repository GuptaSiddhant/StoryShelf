---
title: Deployment
description: Deploy StoryShelf with Docker, subdomains, and auth.
---

## Docker Compose

```yaml
services:
  storyshelf:
    image: storyshelf:latest
    ports:
      - "3000:3000"
    volumes:
      - storyshelf-data:/app/data
    environment:
      - SECRET=$(openssl rand -hex 32) # ≥ 32 chars
      - CAPTURE_CONCURRENCY=2
      - PURGE_TTL_DAYS=30
      - BRANCH_TTL_DAYS=30
      - BRANCH_GC_INTERVAL_MS=86400000
      # Auth (see /guides/auth/): local admin or SSO example
      # - AUTH_PASSWORD=a-long-admin-password   # ≥ 12 chars (local admin, via invite flow)
      # - OIDC_ISSUER=https://keycloak.example.com/realms/myteam
      # - OIDC_CLIENT_ID=storyshelf
      # - OIDC_CLIENT_SECRET=secret
volumes:
  storyshelf-data:
```

## Published Storybook subdomains

Opt in to per-project subdomains by setting `PUBLISHED_BASE_DOMAIN` and adding a wildcard DNS record + TLS cert:

```txt
*.stories.example.com  →  your.server
```

Then `https://<slug>.stories.example.com` serves the latest published Storybook, and `https://<buildId>.<slug>.stories.example.com` serves a specific build.

## Published Storybook compression

Published-file gzip is off by default. To enable it on the StoryShelf server, set:

```ts
createShelfApp({
  database,
  storage,
  config: { publishedCompression: true },
});
```

Set `publishedCompression: false` or omit it to disable generation and serving of variants. Authorized public, signed-in and signed URL requests keep their existing access rules; signed URLs still answer `private, no-store`. The first eligible request receives the original while gzip is generated in the background. Later requests that accept gzip can receive the stored variant. Missing, invalid or unavailable variants always fall back to the original. Legacy files without a content hash remain uncompressed.

Only compressible files up to 8 MiB are eligible. At most two generation jobs and four variant checks run per storage adapter in each process; work above those limits is skipped and can be attempted on a later request. A variant check that takes longer than 250 ms falls back to the original. Variant storage is additional to the original, shared by content hash, and useful for warm transfer size and latency at the cost of CPU, memory and persistent storage. Savings depend on the files and the workload; the first response is uncompressed.

Variants are disposable derived data under `derived/published-gzip/`; originals and manifests stay authoritative. Build retention removes variants when their original content is collected, and subsequent build purges scan up to 128 variants per pass for orphans. The adapter's list operation enumerates the variant namespace before the bounded checks. Variants may be omitted from backups and will regenerate after restore; missing variants do not affect published files.

Playwright's separate `staticCompression: true` option covers only its temporary loopback server and uses an in-memory per-run cache with smaller limits; see [Remote browsers](/guides/remote-browsers/). A reverse proxy can provide compression instead; leave the application options off if the proxy handles it, and preserve authorization and the signed URL cache policy.

## Auth

- **Local accounts** — invite-only email/password via the auth engine (`AUTH_PASSWORD` bootstraps the admin).
- **Social / enterprise SSO** — GitHub, Google, Entra, Keycloak, Okta, Auth0, SAML (see [Auth](/guides/auth/)).
- **None** — for VPN-protected deployments.

## Deployment targets — bring your own assembly

StoryShelf is **cross-runtime**: the core router (`createShelfApp`) uses only Web-standard APIs (`Request`, `Response`, `fetch`, `ReadableStream`, `crypto`, `URL`). There is no Node coupling in the core. This means you can assemble and deploy on any platform that runs JavaScript.

### Recommended assembly (self-hosted default)

Use `storyshelf server init` to scaffold a server with your chosen adapters:

```sh
storyshelf server init
# ? Which database? SQLite
# ? Which storage? Local filesystem
# ? Which auth? None
# ? Which git provider? None
```

This generates `src/index.ts`, `package.json` and `tsconfig.json` with the correct imports and dependencies.

| Layer         | Package                     | Notes                                        |
| ------------- | --------------------------- | -------------------------------------------- |
| Database      | `@storyshelf/db-sqlite`     | node:sqlite + Drizzle, WAL mode, single file |
| Storage       | `@storyshelf/storage-local` | Local filesystem, `--data-dir`               |
| Capture queue | Database queue (built-in)   | `capture_jobs` in your database, leased      |
| Auth          | `@storyshelf/auth`          | Local accounts, social, SSO/SAML, passkeys   |

Swap the database layer for `@storyshelf/db-postgres` (Postgres via `postgres.js` + Drizzle, see [Postgres provider recipes](/packages/db-postgres/#provider-recipes)) or `@storyshelf/db-sqlite/turso` (Turso/libSQL) without changing the rest of the stack.

One `npm start` (or `fly deploy`, `railway up`, `render.com`, etc.) and you're running.

## Remote browsers

Rendering scales on the browser side, not by adding processes: every instance runs the same `testing` configuration, so every instance offers the same targets. To take browsers off the app host, list remote services in the runner's `browsers` (a self-hosted Playwright server, Azure Playwright Workspaces, a CDP service) and the host needs no installed browsers. `sessions` per service is the page cap per instance; divide a provider's parallel-session limit among instances. See [Remote browsers](/guides/remote-browsers/).

## Sizing memory for capture

Capture drives Chromium, which dominates memory use. Each open page costs roughly 100–300 MB, so StoryShelf renders a bounded number of pages at once rather than every story together.

| Setting                                                                                       | Default                                                       | What it controls                                                 |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `testing.concurrency`                                                                         | auto: 2 builds on hosts with ≥ 2 CPUs and ≥ 3 GB, otherwise 1 | Builds captured at the same time (each launches its own browser) |
| `createPlaywrightCaptureRunner({ concurrency })` / `STORYSHELF_CAPTURE_CONCURRENCY`           | auto (see below)                                              | Pages rendering at once within one build                         |
| `createPlaywrightCaptureRunner({ navigationTimeoutMs })` / `STORYSHELF_NAVIGATION_TIMEOUT_MS` | auto: 30 s, 60 s under 2 CPUs, 90 s under 1 CPU               | Per-page navigation and action timeout                           |

| `createPlaywrightCaptureRunner({ reusePages })` / `STORYSHELF_REUSE_PAGES` | off | Reuse a pool of reset pages instead of opening one per capture |
| `createPlaywrightCaptureRunner({ recycleBrowserEvery })` / `STORYSHELF_BROWSER_RECYCLE_EVERY` | `150` (`0` disables) | Captures between browser restarts |

The defaults are sized from the CPU and memory the process can actually use, including container limits (cgroup CPU quota and memory limit), so a 0.5 vCPU / 1 GB container on a big host is treated as 0.5 / 1 GB. Pages at once is the smaller of the CPU count (rounded up), `(memory − 512 MB) / 300 MB`, and 4, with a minimum of 1. In practice:

| Host           | Builds at once | Pages at once | Navigation timeout |
| -------------- | -------------- | ------------- | ------------------ |
| 0.5 vCPU, 1 GB | 1              | 1             | 90 s               |
| 1 vCPU, 2 GB   | 1              | 1             | 60 s               |
| 2 vCPU, 4 GB   | 1              | 2             | 30 s               |
| 4 vCPU, 8 GB   | 2              | 4             | 30 s               |

More pages than CPUs does not make capture faster: the pages compete for the same cores, each loads more slowly, and slow loads time out. The orchestrator also gives each render a time budget of 15 minutes, or 15 seconds per capture for large builds, whichever is longer (an explicit `renderTimeoutMs` always wins). One page at a time on a small host is slower, so a 1,000-capture build gets about 4 hours before it is cancelled as hung; without this, a build that is merely slow would be reported as timed out.

Screenshots are written to storage as each one is captured instead of being held until the whole build has rendered, so memory use no longer grows with the number of stories.

By default every capture opens a fresh page. Set `reusePages: true` (or `STORYSHELF_REUSE_PAGES=1`) to reuse a small pool of pages instead. Each page runs in its own browser context and is reset between captures (cookies, local and session storage and IndexedDB cleared, blank document), and a page that failed a capture is thrown away rather than reused. It is off by default because a story that leaks state outside those resets could affect the next one; on the bundled fixtures, screenshots were byte-identical with reuse on and off. Reuse mostly saves page startup time, which matters most on slower hosts.

Chromium grows slowly over a long run, so the browser is closed and relaunched every 150 captures. The restart happens between batches, after in-flight pages finish, so no capture is interrupted. At the start of every render the runner logs a `capture sizing` line with the detected `cpus` and `memoryMb` and the resulting `pages`, `navigationTimeoutMs` and `recycleBrowserEvery`; check it first if a host behaves differently from the table.

If your platform reserves CPU in a way the container cannot see (for example a VM with a fractional share), the detection cannot know; set the values explicitly.

Node itself is cheap by comparison, but its default heap limit can be larger than what is left once Chromium has its share. On small hosts cap it, for example `NODE_OPTIONS=--max-old-space-size=384` on a 1 GB machine (the Fly demo sets this in `fly.toml`), so Node collects garbage earlier instead of crowding out the browser.

Storing the uploaded Storybook for the published preview handles at most 8 files at a time, so large builds (thousands of files) no longer have to fit in memory. Chromium is launched with low-memory flags (`--disable-dev-shm-usage`, `--disable-extensions`, `--disable-background-networking`, `--mute-audio`); rendering-affecting flags such as `--disable-gpu` are intentionally not used, because they can change pixels and cause false visual diffs.

If builds still run out of memory, lower the runner concurrency first, then add RAM.

## Cloud reference stacks

Enterprise Terraform stacks are available per cloud — each scaffolds one app (it also runs the captures from the database queue), database, storage, auth, and optional DNS/TLS. See the dedicated pages for commands, env wiring, and stable output contracts:

- [AWS — ECS + S3 + Postgres + Cognito](./aws/) — `s3_bucket`, `db_endpoint`, `user_pool_id`
- [Azure — Container Apps + Blob + Postgres + Entra](./azure/) — `storage_connection_string`, `entra_application_id`
- [GCP — Cloud Run + GCS + Postgres + Identity Platform](./gcp/) — `run_url`, `gcs_bucket`, `database_url`
- [Cloud assembly — all clouds equal](./cloud/) — swap each layer independently, with serverless hosting only on Vercel, Cloudflare Workers and Lambda, plus Postgres provider recipes

For single-host Docker Compose or a bare `npm start` on Fly/Railway/Render/VPS, the [Docker Compose](./docker-compose/) page covers the compose file, subdomains, and auth. The cloud assembly page also includes minimal `Turso + S3` and `Postgres + S3` recipes that run on any `fetch`+`crypto` platform.
