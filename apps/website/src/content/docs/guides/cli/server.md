---
title: CLI — Server
description: storyshelf server init and storyshelf server serve — scaffold and run a self-hosted server.
---

Scaffold and run a self-hosted StoryShelf server. For cloud Terraform reference stacks see [Deployment](/guides/deployment/).

## `storyshelf server init`

Scaffold a new server project:

```bash
storyshelf server init
# ? Project name? my-storyshelf
# ? Directory? ./my-storyshelf
# ? Which database? SQLite
# ? Which storage? Local filesystem
# ? Which auth? None
# ? Which git provider? GitHub
```

Generates a small TypeScript project in the target directory:

```
src/index.ts      # the server: it also runs the captures (database queue, no worker)
package.json
tsconfig.json     # editor types; `npm run typecheck` runs tsc
Dockerfile        # only if you choose Docker
compose.yaml      # only when the Docker stack has more than one service
```

Entry code lives in `src/` so you can split logic into more files (use `.ts` in relative imports). The Docker image installs production dependencies and runs `src/index.ts` directly with Node, the same as `npm start`; there is no build step. A single-container setup (for example SQLite + local storage) gets `docker:build` / `docker:run` scripts and no compose file; compose is generated when the stack adds Postgres.

Notifications and OpenTelemetry wiring are opt-in: the generated server only imports what you selected, so the default output stays short.

**Deploy targets** (when prompted, `local`/`docker`/`aws`/`azure`/`gcp`):

- `local` — bare Node
- `docker` — compose file + `docker:*` npm scripts
- `aws` — ECS Fargate app, S3, Postgres (RDS/Aurora DSQL), Cognito — see [AWS deployment](/guides/deployment/aws/)
- `azure` — Container Apps + Blob + Postgres + Entra — see [Azure](/guides/deployment/azure/)
- `gcp` — Cloud Run + GCS + Postgres + Identity Platform — see [GCP](/guides/deployment/gcp/)

The cloud targets pin the enterprise stack, write Terraform under `terraform/`, and add `infra:*` scripts (`infra:init`, `infra:plan`, `infra:apply`, `infra:destroy`, `infra:outputs`). Selecting OAuth on AWS wires `cognitoPreset` automatically; Azure asks for the region, domain and Entra tenant; GCP asks for project ID/region.

## `storyshelf server serve`

Run a scaffolded server project (also the default for bare `storyshelf server`):

```bash
storyshelf server serve --dir ./my-storyshelf --port 3000
```

Looks for `src/index.ts` (also `.js`/`.mjs`), then the older root layout (`server.ts`, `server.js`/`server.mjs`, `index.ts`/`index.js`/`index.mjs`) and spawns it with output inherited; without any entry it directs you to `storyshelf server init`.

See [Getting started](/guides/getting-started/) for the full init flow and [Configuration](/guides/config/) for env vars.
