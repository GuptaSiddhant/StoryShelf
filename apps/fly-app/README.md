# StoryShelf Fly App (apps/fly-app)

Production demo: SQLite on the volume (`db-sqlite`), objects on **Tigris** through `storage-s3` (or on the volume with `storage-local` when no bucket is configured), `runner-playwright` for capture, and **workspace packages** (no publish).

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
- Persistent volume `/data` holds `shelf.db`, and, without a bucket, every stored object too (survives redeploys). With the bucket configured it holds only `shelf.db*` and scratch space.
- `NODE_OPTIONS=--conditions=source` resolves `@storyshelf/*` to `src/` via `exports.source` in `packages/*/package.json:83`.
- `*.fly.dev` wildcard works for `PUBLISHED_BASE_DOMAIN=storyshelf.fly.dev` if set.

## Object storage on Tigris

The 1 GB volume used to hold SQLite **and** every published Storybook, screenshot, baseline and diff. Objects now go to a Tigris bucket (S3-compatible, `@storyshelf/storage-s3`); SQLite stays on the volume.

**Configuration** is Fly secrets only (`fly storage create` sets most of them). `server.ts` reads the bucket from `AWS_BUCKET` (or `BUCKET_NAME`), the endpoint from `AWS_ENDPOINT_URL_S3` (`https://t3.storage.dev`) and the region from `AWS_REGION` (`auto` when unset); the SDK takes `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from the environment by itself. With no bucket set the app uses the volume as before, so removing the secret (`fly secrets unset AWS_BUCKET -a storyshelf`) is the rollback. At boot the server logs one `object storage` line with the storage kind and the endpoint origin, never the bucket, a key or a credential.

**Existing data.** `storage-local` and `storage-s3` both use the storage path (`<projectId>/builds/…`, `<projectId>/content/…`, …) as the key, so the volume's tree copies over unchanged. The deploy that adds the bucket switches the app over at once, and until the copy finishes the old objects are missing from the bucket, so run the copy straight after the deploy:

```sh
fly ssh console -a storyshelf -C "/app/migrate-to-s3.sh --dry-run"   # counts only, writes nothing
fly ssh console -a storyshelf -C "/app/migrate-to-s3.sh"
```

`migrate-to-s3.sh` copies every stored object under `/data` to the bucket under the same key, except `shelf.db*` (SQLite stays), the scratch directory and half-written temp files. It skips keys the bucket already has, so a run that is cut short can be run again, and it prints counts only. Then check that a published Storybook, a screenshot and a diff open on the demo, that a new capture appears in the bucket, and that `du -sh /data` no longer grows apart from `shelf.db`. Only after that, delete the copied directories from the volume by hand (never `shelf.db*`).

**Or re-seed instead of copying.** The demo is rebuildable: run `seed.sh` (the `seed` job does it after a deploy when the fixture changed; delete the demo project first to force it) and the `storyshelf-ui` project refills on the next upload from CI. Then delete the old object directories from the volume.

The adapter's own contract can be checked against a scratch Tigris bucket (never the demo's) with credentials you provide for that run:

```sh
cd packages/storage-s3
LIVE_CLOUD=1 S3_BUCKET=<scratch-bucket> AWS_ENDPOINT_URL_S3=https://t3.storage.dev AWS_REGION=auto \
  AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… nubx vitest run src/s3.live.test.ts
```

## Browser on a Fly Sprite (scale to zero)

The VM can render the demo on its own Chromium, or on `chromium@sprite`: a Playwright server on a hibernating [Fly Sprite](https://sprites.dev) that wakes for a build and sleeps afterwards, so the demo VM can stay small. Files: `sprite.ts` (the target, config only), `sprite/` (the Sprite's proxy, start script and `setup.sh`; see `sprite/README.md`).

**Configuration** is Fly secrets only: `fly secrets set FLY_SPRITES_TOKEN=… SPRITE_BROWSER_SECRET=… -a storyshelf` (the secret is at least 16 characters and is also written into the Sprite by `setup.sh`). Optional `SPRITE_BROWSER_NAME` (default `storyshelf-browser`) and `SPRITE_BROWSER_URL` skip the API lookup. With either secret unset the target does not exist and nothing changes; removing them is the rollback. The server logs only whether it is configured, never the token, the secret or the URL.

**Using it.** Select `chromium@sprite` in the demo project's capture settings, or re-seed with `DEMO_BROWSER=chromium@sprite` (seeding recreates the project, so do that deliberately).

## AI insights on Anthropic (off unless the key is set)

The demo can run AI insights (build triage and project health, ADR 0016) on Anthropic: text only, the cheapest model, a small budget. Files: `ai.ts` (`aiFromEnv`, the profile and budget), `ai.test.ts`, and the wiring in `server.ts`.

**Configuration** is Fly secrets only: `fly secrets set ANTHROPIC_API_KEY=… -a storyshelf`. It must be a Console API key (`sk-ant-api…`); a Claude subscription or a Claude Code OAuth token is not supported (see `apps/website/src/content/docs/ai/setup.mdx`, "Consumer plans are not supported"). Two optional knobs: `SS_AI_MODEL` (default `claude-haiku-5-5`) and `SS_AI_DAILY_TOKENS` (default `100000`; a value that is not a positive whole number falls back to the default, it never turns the budget off). There is one profile, `default`: no screenshot is ever sent (vision is off), output is capped at 1000 tokens for triage and 2000 for project health, and a project may make 5 AI calls an hour. With the key unset there is no AI at all (`501 ai-disabled`, no AI pages), so the demo boots as before and removing the secret (`fly secrets unset ANTHROPIC_API_KEY -a storyshelf`) is the rollback. The server logs one `ai insights` line with the model in use (`null` when off), never the key: the provider reads the key from the environment itself when it makes a call, so it is not in any config the app holds, and the boot check (`ai.setup()`) makes no billed call.

**Set the key only with `AUTH_PASSWORD` (and `SECRET`) also set.** Without login nobody is a site admin, so any visitor could pick the profile for a project and spend the budget; the daily token and per-project call limits cap that, they do not replace identity. **Using it.** Nothing is enabled for a project automatically. As a site admin, open Project settings → AI and pick `default` for `storyshelf-ui` first; watch the AI usage page (`/admin/ai`) before enabling more projects. To spend more, raise `SS_AI_DAILY_TOKENS` with `fly secrets set` (no code change).
