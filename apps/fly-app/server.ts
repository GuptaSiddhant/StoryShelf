/**
 * Fly demo server — local adapters only.
 *
 * Runs from TypeScript source via Node 26 --experimental-transform-types
 * + `source` export condition (NODE_OPTIONS=--conditions=source). Uses
 * workspace packages directly (no publish step), so deploys whatever is
 * at the tagged commit.
 *
 * Mirrors apps/dev-server/src/server.ts wiring:
 *  - @storyshelf/db-sqlite → {DATA_DIR}/shelf.db
 *  - @storyshelf/storage-local → DATA_DIR
 *  - @storyshelf/runner-playwright → Chromium via playwright base image
 */
import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createPasswordAuth } from "@storyshelf/auth-password";
import { createShelfLogger, createShelfRouter } from "@storyshelf/core";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";
import { createLocalStorage } from "@storyshelf/storage-local";

const env = process.env;
const dataDir = env["DATA_DIR"] ?? "/data";
const port = Number(env["PORT"] ?? 3000);
const secret = env["SECRET"];
const authPassword = env["AUTH_PASSWORD"];

mkdirSync(dataDir, { recursive: true });

const database = createSqliteDatabase(`${dataDir}/shelf.db`);
const storage = createLocalStorage(dataDir);
const captureRunner = createPlaywrightCaptureRunner();
const logger = createShelfLogger({ level: env["LOG_LEVEL"] });

const app = createShelfRouter({
  database,
  storage,
  captureRunner,
  logger,
  auth: authPassword && secret ? createPasswordAuth({ password: authPassword, secret }) : undefined,
  config: {
    secret,
    scratchDir: dataDir,
  },
});

await database.migrate();

serve({ fetch: app.fetch, port }, () => {
  logger.info({ port, dataDir }, "StoryShelf fly server listening");
});
