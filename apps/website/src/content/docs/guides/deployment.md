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
      - SECRET=change-me
      - CAPTURE_CONCURRENCY=2
      - PURGE_TTL_DAYS=30
      - BRANCH_TTL_DAYS=30
      - BRANCH_GC_INTERVAL_MS=86400000
      - OIDC_ISSUER=https://keycloak.example.com/realms/myteam
      - OIDC_CLIENT_ID=storyshelf
      - OIDC_CLIENT_SECRET=secret
      # or shared password: AUTH_PASSWORD=change-me
volumes:
  storyshelf-data:
```

## Published Storybook subdomains

Opt in to per-project subdomains by setting `PUBLISHED_BASE_DOMAIN` and adding a wildcard DNS record + TLS cert:

```txt
*.stories.example.com  →  your.server
```

Then `https://<slug>.stories.example.com` serves the latest published Storybook, and `https://<buildId>.<slug>.stories.example.com` serves a specific build.

## Auth

- **OIDC** — plug into Keycloak, Authentik, Okta, GitHub, GitLab.
- **Shared password** — `AUTH_PASSWORD` for small teams.
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

This generates `server.ts` + `package.json` with the correct imports and dependencies.

| Layer | Package | Notes |
|-------|---------|-------|
| Database | `@storyshelf/db-sqlite` | node:sqlite + Drizzle, WAL mode, single file |
| Storage | `@storyshelf/storage-local` | Local filesystem, `--data-dir` |
| Capture queue | `InMemoryCaptureQueue` (built-in) | Async, concurrency-limited, in-process |
| Auth | `@storyshelf/auth-oauth` or `@storyshelf/auth-password` | OIDC or shared password |

Swap the database layer for `@storyshelf/db-postgres` (Postgres via `postgres.js` + Drizzle, see [Postgres provider recipes](#postgres-provider-recipes) below) or `@storyshelf/db-turso` (Turso/libSQL) without changing the rest of the stack.

One `npm start` (or `fly deploy`, `railway up`, `render.com`, etc.) and you're running.

## Cloud reference stacks

Enterprise Terraform stacks are available per cloud — each scaffolds an app + worker, database, storage, queue, auth, and optional DNS/TLS. See the dedicated pages for commands, env wiring, and stable output contracts:

- [AWS — ECS + S3 + SQS + Postgres + Cognito](./aws/) — `s3_bucket`, `queue_url`, `user_pool_id`
- [Azure — Container Apps + Blob + Queues/Service Bus + Postgres + Entra](./azure/) — `storage_connection_string`, `entra_application_id`
- [GCP — Cloud Run + GCS + Pub/Sub + Postgres + Identity Platform](./gcp/) — `run_url`, `gcs_bucket`, `pubsub_topic`
- [Cloud assembly — all clouds equal](./cloud/) — swap each layer independently across Vercel, Cloudflare Workers, Lambda, Deno, and Bun, plus the serverless worker model and Postgres provider recipes

For single-host Docker Compose or a bare `npm start` on Fly/Railway/Render/VPS, the [Docker Compose](./docker-compose/) page covers the compose file, subdomains, and auth. The cloud assembly page also includes minimal `Turso + S3` and `Postgres + S3` recipes that run on any `fetch`+`crypto` platform.
