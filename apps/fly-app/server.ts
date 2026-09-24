import { serve } from "@hono/node-server";
import { createShelfApp } from "@storyshelf/app";
import { createPasswordAuth } from "@storyshelf/auth-password";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";
import { createLocalStorage } from "@storyshelf/storage-local";
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
import { seedDemo } from "./src/seed-demo.ts";

const env = process.env;
const dataDir = env["DATA_DIR"] ?? "/data";
const port = Number(env["PORT"] ?? 3000);
const secret = env["SECRET"];
const authPassword = env["AUTH_PASSWORD"];
const authViewerPassword = env["AUTH_VIEWER_PASSWORD"];
const adminToken = env["STORYSHELF_ADMIN_TOKEN"] ?? env["ADMIN_TOKEN"];

mkdirSync(dataDir, { recursive: true });

const database = createSqliteDatabase(`${dataDir}/shelf.db`);
const storage = createLocalStorage(dataDir);
const captureRunner = createPlaywrightCaptureRunner();

const app = createShelfApp({
  database,
  storage,
  captureRunner,
  auth:
    authPassword && secret
      ? createPasswordAuth({ password: authPassword, viewerPassword: authViewerPassword, secret })
      : undefined,
  config: {
    secret,
    adminToken,
    scratchDir: dataDir,
  },
});

await app.lifecycle.setup();
const logger = app.lifecycle.logger;

const server = serve({ fetch: app.fetch, port }, () => {
  logger.info({ port, dataDir }, "StoryShelf fly server listening");
});

// Always seed demo project in background — isolated to Demo Design System, other projects untouched. Serve irrespective.
// oxlint-disable-next-line unicorn/prefer-top-level-await -- background seed after serve, must not block health check
seedDemo({ database, storage, captureRunner, logger }).catch((error) => {
  logger.error({ err: error }, "demo seed failed — serving irrespective");
});

const shutdown = async (): Promise<void> => {
  await app.lifecycle.teardown();
  server.close();
};
process.on("SIGTERM", () => {
  shutdown().catch(() => {}); // Intentionally empty — shutdown errors are already logged
});
process.on("SIGINT", () => {
  shutdown().catch(() => {}); // Intentionally empty — shutdown errors are already logged
});
