import { serve } from "@hono/node-server";
import { createPasswordAuth } from "@storyshelf/auth-password";
import { createShelfLogger, createShelfRouter } from "@storyshelf/core";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";
import { createLocalStorage } from "@storyshelf/storage-local";
/**
 * Local StoryShelf dev server.
 *
 * Runs directly from TypeScript source with NO build step: `nub watch` applies
 * the `conditions: ["development"]` custom condition from `nub.jsonc`, which
 * resolves every `@storyshelf/*` import to its `.ts`/`.tsx` source (the
 * `source` export condition) via the isolated workspace linker. Node 26 strips
 * types natively, so the whole monorepo is served straight from `src/`.
 *
 * Start it with `nub run serve` from the repo root (auto-restarts on change).
 */
import { mkdirSync } from "node:fs";

const env = process.env;
const dataDir = env["DATA_DIR"] ?? ".dev-data";
const port = Number(env["PORT"] ?? 3000);
const secret = env["SECRET"];
const authPassword = env["AUTH_PASSWORD"];

// Ensure the data directory exists for the sqlite file and storage.
mkdirSync(dataDir, { recursive: true });

// Adapters — swap these to try other combinations.
const database = createSqliteDatabase(`${dataDir}/shelf.db`);
const storage = createLocalStorage(dataDir);
const captureRunner = createPlaywrightCaptureRunner();
const logger = createShelfLogger({ level: env["LOG_LEVEL"] });

const app = createShelfRouter({
  database,
  storage,
  captureRunner,
  logger,
  // Enable a shared-password login by setting AUTH_PASSWORD (and SECRET).
  auth: authPassword && secret ? createPasswordAuth({ password: authPassword, secret }) : undefined,
  config: {
    // `SECRET` signs auth sessions; `scratchDir` is where an uploaded
    // Storybook archive is extracted before Playwright renders it.
    secret,
    scratchDir: dataDir,
  },
});

await database.migrate();

serve({ fetch: app.fetch, port }, () => {
  logger.info({ port, dataDir }, "StoryShelf dev server listening");
});
