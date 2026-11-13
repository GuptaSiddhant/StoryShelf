---
title: Docker Compose
description: Self-host StoryShelf with Docker Compose, local Postgres, and filesystem storage.
---

The simplest self-hosted deploy: one container, no cloud dependencies. Every stable release publishes
`ghcr.io/guptasiddhant/storyshelf` for `linux/amd64` and `linux/arm64`, with an SBOM and provenance
attestation.

:::caution
The container image is published from v0.12.0. Until that release, build it from the repository's [Dockerfile](https://github.com/GuptaSiddhant/StoryShelf/blob/main/apps/server-image/Dockerfile).
:::

## Quick start

```sh
docker run -p 3000:3000 -v storyshelf:/data ghcr.io/guptasiddhant/storyshelf
```

Open `http://localhost:3000`. With no other settings, the image keeps SQLite and uploaded files on the
`/data` volume and captures with its bundled Chromium. It runs as a non-root user under `tini`, and its
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
| `SECRET`                                                  | At least 32 characters; encrypts stored credentials.                     |
| `PUBLIC_BASE_URL`                                         | The public origin; required for notification links.                      |
| `AUTH_PASSWORD`, `AUTH_EMAIL`                             | Bootstrap the local admin (needs `SECRET`).                              |
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
      # Auth — see /guides/auth/
      # - AUTH_PASSWORD=a-long-admin-password   # ≥ 12 chars (local admin)
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
- **None** — for VPN-protected deployments.

For cloud targets see [AWS](/guides/deployment/aws/), [Azure](/guides/deployment/azure/), and [GCP](/guides/deployment/gcp/). The [cloud assembly guide](/guides/deployment/cloud/) covers swapping each layer independently across Vercel, Cloudflare, Bun, and Lambda.
