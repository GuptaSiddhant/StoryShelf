# syntax=docker/dockerfile:1
# StoryShelf product image (#887): `ghcr.io/guptasiddhant/storyshelf:<version>` (with Chromium) and
# `:<version>-hosting` (no browser, capture off). release.yml builds and pushes both on a stable release.
# Build context MUST be the repo root:
#   docker build -f apps/server-image/Dockerfile .                       # with Chromium (target `full`, the last stage)
#   docker build -f apps/server-image/Dockerfile --target hosting .      # hosting only
#
# Toolchain lines (nub/turbo today, ADR 0047 later) are the three marked TOOLCHAIN: the
# stage that installs the package manager, the prune, and the install. Nothing else names them.

# TOOLCHAIN 1/3: Node 24 with nub from npm. Slim images ship no system CA store, which nub needs for registry HTTPS.
FROM node:24-bookworm-slim AS toolchain
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm i -g @nubjs/nub@0.9.5

# TOOLCHAIN 2/3: prune the workspace to server-image and its dependencies (output lock renamed to nub.lock).
FROM toolchain AS pruner
WORKDIR /app
COPY package.json nub.lock nub.jsonc turbo.json ./
COPY config ./config
COPY packages ./packages
COPY apps ./apps
RUN nubx --yes turbo@2.11.2 prune server-image --docker --out-dir out && mv out/json/pnpm-lock.yaml out/json/nub.lock

FROM toolchain AS builder
# Native install scripts (bufferutil, from @vercel/postgres) have no prebuilt binary on every
# platform; on linux/arm64 they compile with node-gyp, which needs Python and a C++ toolchain. This
# stage only: the shipped images copy the bundle, never these tools.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=pruner /app/out/json ./
COPY --from=pruner /app/nub.jsonc ./nub.jsonc
COPY --from=pruner /app/turbo.json ./turbo.json
COPY --from=pruner /app/config ./config
RUN chown -R node:node /app
USER node
# TOOLCHAIN 3/3: install the pruned dependencies.
RUN --mount=type=cache,target=/root/.cache/nub,id=nub-cache \
    nub install --frozen-lockfile
COPY --chown=node:node --from=pruner /app/out/full ./
# Bundle the workspace into one file; pino, Playwright and sharp stay external (rolldown.config.ts).
RUN nubx rolldown -c apps/server-image/rolldown.config.ts

# Shared by both variants: the bundle, tini and a non-root user that owns /data.
FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/apps/server-image/dist ./dist
COPY --from=builder /app/apps/server-image/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
# `node` (uid 1000) owns the data volume: SQLite, local storage and scratch space.
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/server.mjs"]

# Hosting only: no browser, so capture is off (`SHELF_CAPTURE=off`). Hosting and review still work.
FROM base AS hosting
ENV SHELF_CAPTURE=off
USER node
VOLUME /data

# The default: with chrome-headless-shell for server-side capture. Headless capture needs only the
# shell, so skip the full Chromium download. The browser lives outside /root so the non-root user
# can read it; its version always matches the locked playwright-core.
FROM base AS full
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/*
USER node
VOLUME /data
