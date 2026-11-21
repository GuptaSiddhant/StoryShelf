---
title: Docker Compose
description: Self-host StoryShelf with Docker Compose, local Postgres, and filesystem storage.
---

The simplest self-hosted deploy: one container, no cloud dependencies. Every stable release publishes
`ghcr.io/guptasiddhant/storyshelf` for `linux/amd64` and `linux/arm64`, with an SBOM and provenance
attestation. The same image is mirrored to Docker Hub as `docker.io/guptasiddhant/storyshelf`, from
the first release that has the mirror configured. The examples below use the GHCR name.

:::caution
The container image is published from v0.12.0. Until that release, build it from the repository's [Dockerfile](https://github.com/GuptaSiddhant/StoryShelf/blob/main/apps/server-image/Dockerfile).
:::

## Quick start

```sh
# Generate SHELF_SECRET once and store it safely: it encrypts stored credentials, so every later run on
# the same volume needs the same value.
export SHELF_SECRET="$(openssl rand -hex 32)"
# Choose a private admin password (at least 12 characters); it is not echoed.
printf 'Admin password: '; stty -echo; read -r SHELF_ADMIN_PASSWORD; stty echo; echo
export SHELF_ADMIN_PASSWORD
docker run -p 127.0.0.1:3000:3000 -v storyshelf:/data -e SHELF_SECRET -e SHELF_ADMIN_PASSWORD \
  ghcr.io/guptasiddhant/storyshelf
```

Open `http://localhost:3000` and sign in as `admin@example.com` with your `SHELF_ADMIN_PASSWORD` (the port is
published on this machine only; drop `127.0.0.1:` to expose it). Sign-in is on by default: without
`SHELF_ADMIN_PASSWORD`, or with a `SHELF_SECRET` that is unset or shorter than 32 characters, the image refuses to
start and names the variable. To try it without sign-in, set `SHELF_AUTH=none` in place of
`SHELF_ADMIN_PASSWORD` (every route is open, and the log warns that it listens on all addresses). The image keeps SQLite and uploaded files on
the `/data` volume and captures with its bundled Chromium. It runs as a non-root user under `tini`, and its
`HEALTHCHECK` calls `/api/v1/health`.

## Tags

| Tag                                     | Contents                                                                |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `:<version>`, `:latest`                 | The app and Chromium for server-side capture.                           |
| `:<version>-hosting`, `:latest-hosting` | No browser, capture off (`SHELF_CAPTURE=off`): hosting and review only. |

Pin `:<version>` in production. A `next` build is never pushed.

## Settings

Everything comes from the environment:

| Variable                                                                                                           | Effect                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                                     | `postgres://…` or `mysql://…`. Unset: SQLite at `/data/shelf.db`.                                                                                                                                                                                              |
| `SHELF_DATABASE_CA` / `SHELF_DATABASE_CA_FILE`                                                                     | PEM text, or a path to a PEM file, of the CA that signed the database's certificate. Set one, not both. See [Verify the database certificate](/guides/deployment/cloud/#verify-the-database-certificate).                                                      |
| `SHELF_DATABASE_IAM_HOST`, `SHELF_DATABASE_IAM_USER`, `SHELF_DATABASE_IAM_NAME`, `SHELF_DATABASE_IAM_REGION`       | RDS or Aurora Postgres with short-lived IAM tokens (task or instance role); `AWS_REGION` replaces the region, `SHELF_DATABASE_IAM_PORT` the port. Incomplete, or set together with `DATABASE_URL`: the server refuses to start, it never falls back to SQLite. |
| `SHELF_DATABASE_POOL_MAX`                                                                                          | Most Postgres connections per copy (default: the driver's).                                                                                                                                                                                                    |
| `SHELF_S3_BUCKET`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`                                                             | S3-compatible storage (credentials from the AWS SDK chain). Unset: `/data`.                                                                                                                                                                                    |
| `SHELF_SECRET`                                                                                                     | At least 32 characters; signs sessions and encrypts stored credentials. Required with sign-in.                                                                                                                                                                 |
| `SHELF_SECRET_PREVIOUS`, `SHELF_SECRET_MIGRATE=true`                                                               | Rotate `SHELF_SECRET` without losing stored credentials: see [Rotating the server secret](/guides/deployment/secret-rotation/).                                                                                                                                |
| `SHELF_PUBLIC_BASE_URL`                                                                                            | The public origin; required for notification links.                                                                                                                                                                                                            |
| `SHELF_ADMIN_PASSWORD`, `SHELF_ADMIN_EMAIL`                                                                        | Bootstrap the local admin (needs `SHELF_SECRET`). Required unless `SHELF_AUTH=none`.                                                                                                                                                                           |
| `SHELF_AUTH=none`                                                                                                  | Run without sign-in: every route is open. Refused together with `SHELF_ADMIN_PASSWORD`.                                                                                                                                                                        |
| `SHELF_STORYBOOK_HOSTING`                                                                                          | `trusted` (default) or `sandboxed`. See [Hosting uploaded Storybooks](/guides/security/#hosting-uploaded-storybooks). Any other value stops the server.                                                                                                        |
| `SHELF_SMTP_*`                                                                                                     | Email notifications and invites.                                                                                                                                                                                                                               |
| `SHELF_INTEGRATIONS_DISABLED`                                                                                      | Kinds projects are not offered, comma-separated (`slack,teams,figma`). An unknown kind stops startup.                                                                                                                                                          |
| `SHELF_GITHUB_APP_ID`, `SHELF_GITHUB_APP_PRIVATE_KEY[_FILE]`, `SHELF_GITLAB_TOKEN[_FILE]`, `SHELF_GIT_CONFIG_FILE` | A server-wide git connection for merge gates and pull-request comments: see [Server-wide connection from configuration](/guides/merge-gate/#server-wide-connection-from-configuration). Prefer the `_FILE` form for the key and the token.                     |
| `PLAYWRIGHT_SERVICE_URL`, `PLAYWRIGHT_SERVICE_ACCESS_TOKEN`                                                        | Adds `chromium@azure` (Azure Playwright Workspaces, experimental). Off unless both are set.                                                                                                                                                                    |
| `SHELF_CAPTURE=off`                                                                                                | Hosting only: no capture, compare or baselines.                                                                                                                                                                                                                |

## Compose file

```yaml
services:
  storyshelf:
    image: ghcr.io/guptasiddhant/storyshelf:latest
    ports:
      - "3000:3000"
    volumes:
      - storyshelf-data:/data
    environment:
      # Set both in the shell or an .env file; generate SHELF_SECRET once and keep it.
      - SHELF_SECRET=${SHELF_SECRET:?set SHELF_SECRET to at least 32 random characters}
      - SHELF_PUBLIC_BASE_URL=http://localhost:3000
      # Postgres instead of SQLite:
      # - DATABASE_URL=postgres://storyshelf:password@db:5432/storyshelf
      # Auth — see /guides/auth/. To run without sign-in, replace the SHELF_ADMIN_PASSWORD line below with
      # SHELF_AUTH=none (the image refuses to start with both set).
      - SHELF_ADMIN_PASSWORD=${SHELF_ADMIN_PASSWORD:?set SHELF_ADMIN_PASSWORD (at least 12 characters)}
volumes:
  storyshelf-data:
```

## Keep it running

Captures run in the background after an upload. Run the container on a host that does not stop it when traffic stops; if you move it to Fly, Render or Railway, read [Keep one instance running](/guides/deployment/#keep-one-instance-running) first.

## Published Storybook subdomains

Opt in to per-project subdomains by setting `PUBLISHED_BASE_DOMAIN` and adding a wildcard DNS record + TLS cert:

```txt
*.stories.example.com  →  your.server
```

Then `https://<slug>.stories.example.com` serves the latest published Storybook, and `https://<buildId>.<slug>.stories.example.com` serves a specific build.

## Auth

- **Local accounts** — invite-only (`SHELF_ADMIN_PASSWORD` ≥ 12 bootstraps the first admin).
- **Social / enterprise SSO / passkeys** — GitHub, Google, Entra, Keycloak, Okta, SAML, WebAuthn (see [Auth](/guides/auth/)).
- **None** — for VPN-protected deployments: set `SHELF_AUTH=none` explicitly; the image never turns sign-in off because a variable is missing.

For cloud targets see [AWS](/guides/deployment/aws/), [Azure](/guides/deployment/azure/), and [GCP](/guides/deployment/gcp/). The [cloud assembly guide](/guides/deployment/cloud/) covers swapping each layer independently across Vercel, Cloudflare, Bun, and Lambda.
