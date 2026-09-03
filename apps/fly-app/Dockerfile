# syntax=docker/dockerfile:1
# Fly demo — local adapters, workspace versions, rolldown bundle.
# Build context MUST be repo root: `fly deploy . --config apps/fly-app/fly.toml --dockerfile apps/fly-app/Dockerfile`
# Uses turbo prune + pnpm trick to trim nub.lock so `nub install --frozen-lockfile` only fetches fly-app deps.

FROM ghcr.io/nubjs/nub:0.8.1 AS pruner
WORKDIR /app
COPY package.json nub.lock nub.jsonc turbo.json ./
COPY config ./config
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
# Trick turbo into pruning nub.lock as pnpm-lock.yaml (nub.lock is pnpm v9 format)
RUN cp nub.lock pnpm-lock.yaml && npx --yes turbo@2.10.12 prune fly-app --docker --out-dir out && node scripts/prune-nub-lock.mjs out --verbose && rm pnpm-lock.yaml

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
# Bundle workspace @storyshelf/* into single mjs; keep native + npm deps external
RUN npx rolldown -c apps/fly-app/rolldown.config.ts

FROM node:26-bookworm-slim
WORKDIR /app
# Copy bundled server + chunks and hoisted node_modules (external npm deps + native)
COPY --from=builder /app/apps/fly-app/dist ./dist
COPY --from=builder /app/apps/fly-app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
# Install chromium + system deps (node:slim has no browsers)
RUN npm i -g playwright@1.62.1 && playwright install --with-deps chromium
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/auth/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.mjs"]
