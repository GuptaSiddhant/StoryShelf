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
docker run -p 3000:3000 -v storyshelf:/data \
  -e SECRET="$(openssl rand -hex 32)" -e AUTH_PASSWORD=a-long-admin-password \
  ghcr.io/guptasiddhant/storyshelf
```

Open `http://localhost:3000` and sign in as `admin@example.com`. Sign-in is on by default: without
`AUTH_PASSWORD`, or with a `SECRET` that is unset or shorter than 32 characters, the image refuses to
start and names the variable. To try it without sign-in, set `SHELF_AUTH=none` instead (every route is
open, and the log warns that it listens on all addresses). The image keeps SQLite and uploaded files on
the `/data` volume and captures with its bundled Chromium. It runs as a non-root user under `tini`, and its
`HEALTHCHECK` calls `/api/v1/health`.

## Tags

| Tag                              | Contents                                                       |
| -------------------------------- | -------------------------------------------------------------- |
| `:<version>`, `:latest`          | The app and Chromium for server-side capture.                  |
| `:<version>-hosting`, `:latest-hosting` | No browser, capture off (`SHELF_CAPTURE=off`): hosting and review only. |

Pin `:<version>` in production. A `next` build is never pushed.

## Settings

Everything comes from the environment:

| Variable                                                  | Effect                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `DATABASE_URL`                                            | `postgres://…` or `mysql://…`. Unset: SQLite at `/data/shelf.db`.        |
| `AWS_BUCKET`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`         | S3-compatible storage (credentials from the AWS SDK chain). Unset: `/data`. |
| `SECRET`                                                  | At least 32 characters; signs sessions and encrypts stored credentials. Required with sign-in. |
| `PUBLIC_BASE_URL`                                         | The public origin; required for notification links.                      |
| `AUTH_PASSWORD`, `AUTH_EMAIL`                             | Bootstrap the local admin (needs `SECRET`). Required unless `SHELF_AUTH=none`. |
| `SHELF_AUTH=none`                                         | Run without sign-in: every route is open. Refused together with `AUTH_PASSWORD`. |
| `SMTP_*`                                                  | Email notifications and invites.                                         |
| `PLAYWRIGHT_SERVICE_URL`, `PLAYWRIGHT_SERVICE_ACCESS_TOKEN` | Adds `chromium@azure` (Azure Playwright Workspaces, experimental). Off unless both are set. |
| `SHELF_CAPTURE=off`                                       | Hosting only: no capture, compare or baselines.                          |

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
      - SECRET=change-me-to-32-or-more-random-characters
      - PUBLIC_BASE_URL=http://localhost:3000
      # Postgres instead of SQLite:
      # - DATABASE_URL=postgres://storyshelf:password@db:5432/storyshelf
      # Auth — see /guides/auth/ (or SHELF_AUTH=none to run without sign-in)
      - AUTH_PASSWORD=a-long-admin-password   # ≥ 12 chars (local admin)
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

- **Local accounts** — invite-only (`AUTH_PASSWORD` ≥ 12 bootstraps the first admin).
- **Social / enterprise SSO / passkeys** — GitHub, Google, Entra, Keycloak, Okta, SAML, WebAuthn (see [Auth](/guides/auth/)).
- **None** — for VPN-protected deployments: set `SHELF_AUTH=none` explicitly; the image never turns sign-in off because a variable is missing.

For cloud targets see [AWS](/guides/deployment/aws/), [Azure](/guides/deployment/azure/), and [GCP](/guides/deployment/gcp/). The [cloud assembly guide](/guides/deployment/cloud/) covers swapping each layer independently across Vercel, Cloudflare, Bun, and Lambda.
