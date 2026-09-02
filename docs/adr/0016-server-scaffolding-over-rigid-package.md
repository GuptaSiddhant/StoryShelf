# ADR 0016: Server Scaffolding Over Rigid Package

## Status

Accepted

## Context

As new adapters are added (db-turso, storage-s3, auth-oauth, auth-password), the `@storyshelf/node-server` package faces a combinatorial explosion. It hardcodes a specific stack: SQLite + local storage + Playwright + GitHub. Supporting alternative deployments (Turso + S3, or no auth, or no git) requires either:

1. **Config flags** — Select adapters via env vars. This creates conditional imports and a combinatorial testing matrix. A server with 5 adapter slots and 2 options each = 32 combinations.
2. **Multiple server packages** — One per deployment target. Maintenance burden scales with adapter count.
3. **Scaffolding** — Generate a server file with the user's chosen adapters. The user owns the code; we maintain templates, not combinations.

The adapter composition pattern (ADR 0001) already supports this: `createShelfRouter({ database, storage, capture, ... })` takes all adapters as params. The missing piece is a developer-facing entry point.

## Decision

1. **Add `storyshelf server init` to `@storyshelf/cli`** (originally `storyshelf create`, later namespaced under `server`) — Interactive prompts select adapters, generate `server.ts` + `package.json`.

2. **Deprecate `@storyshelf/node-server` as a published package** — Replace with templates in the CLI. The existing package remains for backward compatibility but is no longer the recommended approach.

3. **Keep commander, add `prompts`** — Commander handles command parsing (existing commands stay unchanged). `prompts` handles interactive selection in the new `server init` command only.

### Generated output example

```typescript
// server.ts
import { serve } from "@hono/node-server";
import { createShelfRouter } from "@storyshelf/core";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createLocalStorage } from "@storyshelf/storage-local";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";

const database = createSqliteDatabase("./data/shelf.db");
const storage = createLocalStorage("./data");
const captureRunner = createPlaywrightCaptureRunner();

const app = createShelfRouter({ database, storage, captureRunner });
serve({ fetch: app.fetch, port: 3000 });
```

### Command interface

```
$ storyshelf server init

? Project name: my-app
? Directory: ./my-app
? Database: SQLite / Turso
? Storage: Local / S3
? Auth: OAuth / Password / None
? Git provider: GitHub / GitLab / None

✓ Created package.json
✓ Created server.ts
```

## Alternatives considered

| Approach | Why rejected |
|----------|--------------|
| Config-driven server | Combinatorial explosion; conditional imports obscure dependencies |
| Multiple server packages | Maintenance burden scales with adapter count |
| Framework switch (oclif/inquirer) | Rewrite existing commands for marginal benefit |
| Recipe docs only | No "one command" convenience; users still copy-paste |

## Consequences

**Positive:**
- Users own their server file — modify freely, no package upgrade friction
- New adapters don't require server package changes
- CLI scaffolds correct imports + package.json deps automatically
- Existing commands (`init`, `upload`, `retry`, `purge`) unaffected

**Negative:**
- Two dependencies in CLI (commander + prompts) instead of one
- Users must run `npm install` after scaffolding
- Templates need maintenance as new adapters are added
