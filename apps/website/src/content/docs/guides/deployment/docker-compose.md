---
title: Docker Compose
description: Self-host StoryShelf with Docker Compose, local Postgres, and filesystem storage.
---

The simplest self-hosted deploy — one compose file, no cloud dependencies.

## Compose file

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

Swap the database for `@storyshelf/db-postgres` or `@storyshelf/db-turso` without changing the rest of the stack.

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

For cloud targets see [AWS](/guides/deployment/aws/), [Azure](/guides/deployment/azure/), and [GCP](/guides/deployment/gcp/). The [cloud assembly guide](/guides/deployment/cloud/) covers swapping each layer independently across Vercel, Cloudflare, Deno, Bun, and Lambda.
