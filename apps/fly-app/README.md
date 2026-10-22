# StoryShelf Fly App (apps/fly-app)

Production demo using **local adapters** (`db-sqlite` + `storage-local` + `runner-playwright`) and **workspace packages** (no publish).

- `server.ts` mirrors `apps/dev-server/src/server.ts:1` but with `DATA_DIR=/data`, `PORT=3000`, `SECRET`/`AUTH_PASSWORD` via Fly secrets.
- `Dockerfile` is multi-stage, cache-efficient, and uses `ghcr.io/nubjs/nub:0.8.1` for `nub install --frozen-lockfile` with BuildKit cache mount, then `mcr.microsoft.com/playwright:v1.62.1-noble` for runtime. Build context must be **repo root**.

## Local run

```sh
nub install
DATA_DIR=.dev-data node --conditions=source --experimental-transform-types apps/fly-app/server.ts
```

## Fly deploy (manual)

```sh
fly apps create storyshelf
fly volumes create storyshelf_data --region iad --size 1
fly secrets set SECRET=$(openssl rand -hex 32) --app storyshelf
# optional: fly secrets set AUTH_PASSWORD=... --app storyshelf
fly deploy . --config apps/fly-app/fly.toml --dockerfile apps/fly-app/Dockerfile --remote-only
fly status -a storyshelf
```

`.github/workflows/fly.yml` deploys on every push to `main`. Demo data is seeded by the `seed` job after each deploy (`seed.sh`: builds the fixture, uploads it through the API, and re-seeds only when the fixture changed). It needs the `STORYSHELF_ADMIN_TOKEN` repo secret to match the Fly secret.

## Notes

- Capture concurrency is sized automatically from the VM's CPU and memory (1 build, 1 page at a time on the 1 GB shared-CPU VM). Set `CAPTURE_CONCURRENCY` in `fly.toml` to override the page count; raise it only after scaling `[[vm]]` CPUs and memory.
- `NODE_OPTIONS=--max-old-space-size=384` in `fly.toml` caps the Node heap so Chromium keeps the rest of the 1 GB. Raise it together with `[[vm]] memory`.
- Persistent volume `/data` holds `shelf.db` + `builds/` + `baselines/` (survives redeploys).
- `NODE_OPTIONS=--conditions=source` resolves `@storyshelf/*` to `src/` via `exports.source` in `packages/*/package.json:83`.
- `*.fly.dev` wildcard works for `PUBLISHED_BASE_DOMAIN=storyshelf.fly.dev` if set.
