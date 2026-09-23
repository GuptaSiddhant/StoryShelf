# syntax=docker/dockerfile:1
# Fly demo — local adapters, workspace versions, rolldown bundle.
# Build context MUST be repo root: `fly deploy . --config apps/fly-app/fly.toml --dockerfile apps/fly-app/Dockerfile`
# Turbo 2.11+ prunes nub.lock natively (pnpm v9 format) — output lock is
# pnpm-lock.yaml, renamed to nub.lock for `nub install --frozen-lockfile`.

FROM ghcr.io/nubjs/nub:0.8.1 AS pruner
WORKDIR /app
COPY package.json nub.lock nub.jsonc turbo.json ./
COPY config ./config
COPY packages ./packages
COPY apps ./apps
COPY fixtures/storybook-8 ./fixtures/storybook-8
RUN nubx --yes turbo@2.11.2 prune fly-app --docker --out-dir out && mv out/json/pnpm-lock.yaml out/json/nub.lock

FROM ghcr.io/nubjs/nub:0.8.1 AS builder
WORKDIR /app
USER root
# Copy pruned package.json + lock for install (json) plus nub config
COPY --from=pruner /app/out/json ./
COPY --from=pruner /app/nub.jsonc ./nub.jsonc
COPY --from=pruner /app/turbo.json ./turbo.json
COPY --from=pruner /app/config ./config
RUN chown -R node:node /app
USER node
# Install only pruned deps (fly-app + its 5 workspace deps) — pruned lock is 116K vs 312K
RUN --mount=type=cache,target=/root/.cache/nub,id=nub-cache \
    nub install --frozen-lockfile
# Then copy pruned source for bundling (full) — overwrites package.json with full source
COPY --from=pruner /app/out/full ./
# Ensure demo seed file is present even if prune cache is stale (new file)
COPY apps/fly-app/src/seed-demo.ts ./apps/fly-app/src/seed-demo.ts
# Copy only the fixture needed for demo seed — build static inside image so repo stays clean (fixtures/**/storybook-static is gitignored)
COPY fixtures/storybook-8 ./fixtures/storybook-8
USER root
RUN chown -R node:node /app/fixtures
USER node
RUN npm --prefix fixtures/storybook-8 install && npm --prefix fixtures/storybook-8 run build-storybook
# Bundle workspace @storyshelf/* into single mjs; keep native + npm deps external
RUN nubx rolldown -c apps/fly-app/rolldown.config.ts

FROM node:26-bookworm-slim
WORKDIR /app
# Copy bundled server + chunks and hoisted node_modules (external npm deps + native)
COPY --from=builder /app/apps/fly-app/dist ./dist
COPY --from=builder /app/apps/fly-app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/fixtures/storybook-8 ./fixtures/storybook-8
# Vendored HTMX bundle. The app resolves it as `../assets/htmx.min.js` relative
# to `import.meta.url`, which for the bundled `/app/dist/server.mjs` is
# `/app/assets/htmx.min.js` — a path the bundler does not emit on its own.
COPY --from=builder /app/packages/app/src/assets/htmx.min.js ./assets/htmx.min.js
# Install chromium + system deps (node:slim has no browsers)
RUN npm i -g playwright@1.63.0 && playwright install --with-deps chromium
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.mjs"]
