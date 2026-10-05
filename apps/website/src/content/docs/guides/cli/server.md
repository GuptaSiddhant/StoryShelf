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

Generates `server.ts` + `package.json` (and `Dockerfile`/`compose.yaml` if selected) in the target directory.

**Deploy targets** (when prompted, `local`/`docker`/`aws`/`azure`/`gcp`):

- `local` — bare Node
- `docker` — compose file + `docker:*` npm scripts
- `aws` — ECS Fargate app + worker, S3, SQS + DLQ, Postgres (RDS/Aurora DSQL), Cognito — see [AWS deployment](/guides/deployment/aws/)
- `azure` — Container Apps + Blob + Storage Queues/Service Bus + Postgres + Entra — see [Azure](/guides/deployment/azure/)
- `gcp` — Cloud Run + GCS + Pub/Sub + Postgres + Identity Platform — see [GCP](/guides/deployment/gcp/)

The cloud targets pin the enterprise stack, write Terraform under `terraform/`, and add `infra:*` scripts (`infra:init`, `infra:plan`, `infra:apply`, `infra:destroy`, `infra:outputs`). Selecting OAuth on AWS wires `cognitoPreset` automatically; Azure asks for queue backend (Storage Queues vs Service Bus); GCP asks for project ID/region.

## `storyshelf server serve`

Run a scaffolded server project (also the default for bare `storyshelf server`):

```bash
storyshelf server serve --dir ./my-storyshelf --port 3000
```

Looks for `server.ts`, `server.js`/`server.mjs`, then `index.ts`/`index.js`/`index.mjs` and spawns it with output inherited; without any entry it directs you to `storyshelf server init`.

See [Getting started](/guides/getting-started/) for the full init flow and [Configuration](/guides/config/) for env vars.
