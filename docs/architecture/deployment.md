# Deployment

> Part of the [StoryShelf architecture spec](./README.md).

## Deployment

### Docker (recommended)

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
      # Capture + retention
      - CAPTURE_CONCURRENCY=2
      - PURGE_TTL_DAYS=30
      - BRANCH_TTL_DAYS=30
      - BRANCH_GC_INTERVAL_MS=86400000
      # Published Storybook subdomains (optional — omit for path-based URLs only)
      # - PUBLISHED_BASE_DOMAIN=stories.example.com   # requires wildcard DNS + TLS
      # Auth (optional — omit for no auth; see /guides/auth/)
      # - AUTH_PASSWORD=a-long-admin-password   # ≥ 12 chars (local admin)
      # - OIDC_ISSUER=https://keycloak.example.com/realms/myteam
      # - OIDC_CLIENT_ID=storyshelf
      # - OIDC_CLIENT_SECRET=secret
      # SECRET must be ≥ 32 chars (e.g. openssl rand -hex 32)
      # Bootstrap (optional — first site admin before any user exists):
      # - STORYSHELF_ADMIN_TOKEN=your-long-random-token  # or ADMIN_TOKEN
      #   `SECRET` signs sessions; `STORYSHELF_ADMIN_TOKEN` grants site-admin
      #   API access (project creation, purge). Never the same value.

volumes:
  storyshelf-data:
```

Capture runs **in-process** on the server using the image's own Playwright browsers — no Docker socket mount, no repo cloning.

### Development

```sh
nubx nub install
nubx nub run dev          # starts Hono dev server
```
