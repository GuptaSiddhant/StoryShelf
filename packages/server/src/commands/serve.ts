// oxlint-disable max-statements
import { serve } from "@hono/node-server";
import { createShelfLogger, createShelfRouter, type ShelfConfig } from "@storyshelf/core";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";
import { createLocalStorage } from "@storyshelf/storage-local";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Options for the `serve` command. */
export interface ServeOptions {
  /** Port to listen on. */
  port: string;
  /** Directory for local data and storage. */
  dataDir: string;
  /** Session signing secret. */
  secret?: string;
  /** Concurrent capture jobs. */
  captureConcurrency: string;
  /** Purge builds older than this many days. */
  purgeTtlDays: string;
  /** Minimum log level to emit. */
  logLevel?: string;
}

/**
 * Start the StoryShelf server.
 *
 * @param options - Serve command options.
 */
export async function runServe(options: ServeOptions): Promise<void> {
  const dataDir = resolve(options.dataDir);
  await mkdir(dataDir, { recursive: true });
  const database = createSqliteDatabase(join(dataDir, "shelf.db"));
  await database.migrate();
  const storage = createLocalStorage(dataDir);
  const logger = createShelfLogger({ level: options.logLevel, env: process.env["NODE_ENV"] });
  const capture = createPlaywrightCaptureRunner();
  const config: ShelfConfig = {
    secret: options.secret,
    captureConcurrency: Number(options.captureConcurrency),
    scratchDir: dataDir,
    purgeTtlDays: Number(options.purgeTtlDays),
  };
  const app = createShelfRouter({ database, storage, capture, config, logger });
  const server = serve({ fetch: app.fetch, port: Number(options.port) });
  server.on("listening", () => {
    logger.info({ url: `http://localhost:${options.port}` }, "server listening");
  });
}
