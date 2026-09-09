# @storyshelf/db-postgres

Postgres database adapter for StoryShelf (postgres.js + Drizzle). Connects to AWS RDS, GCP Cloud SQL, Supabase, Neon, Azure Database, or self-hosted Postgres. See [Deployment](../../apps/website/src/content/docs/guides/deployment.md) for provider recipes.

## Install

```sh
nub add @storyshelf/db-postgres
```

## Quick start (self-hosted)

```ts
import { createPostgresDatabase } from "@storyshelf/db-postgres";

const db = createPostgresDatabase({ url: "postgres://user:pass@localhost:5432/shelf" });
```

For managed providers, pass `ssl`, `prepare`, and pool options via `options` or inject a preconfigured `client` (see `PostgresDatabaseOptions`).
