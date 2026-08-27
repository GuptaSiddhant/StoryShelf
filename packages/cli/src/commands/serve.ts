import { serve } from "@hono/node-server";
import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { createShelfRouter, type ShelfConfig } from "@storyshelf/core";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createLocalStorage } from "@storyshelf/storage-local";

import { createPlaywrightCaptureRunner } from "../capture-runner.ts";

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
  const capture = createPlaywrightCaptureRunner({ db: database, storage, dataDir });
  const config: ShelfConfig = {
    secret: options.secret,
    captureConcurrency: Number(options.captureConcurrency),
    purgeTtlDays: Number(options.purgeTtlDays),
  };
  const app = createShelfRouter({ database, storage, capture, config });
  const server = serve({ fetch: app.fetch, port: Number(options.port) });
  server.on("listening", () => {
    // eslint-disable-next-line no-console
    console.log(`Server is running on http://localhost:${options.port}`);
  });
}
