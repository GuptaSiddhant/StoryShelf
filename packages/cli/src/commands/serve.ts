import { serve } from "@hono/node-server";
import { join, resolve } from "node:path";
import { createShelfRouter, type ShelfConfig } from "@storyshelf/core";
import { createSqliteDatabase } from "@storyshelf/sqlite";
import { createLocalStorage } from "@storyshelf/storage-local";

import { createPlaywrightCaptureRunner } from "../capture-runner.ts";

export interface ServeOptions {
  port: string;
  dataDir: string;
  secret?: string;
  captureConcurrency: string;
  purgeTtlDays: string;
}

export async function runServe(options: ServeOptions): Promise<void> {
  const dataDir = resolve(options.dataDir);
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
  serve({ fetch: app.fetch, port: Number(options.port) });
}
