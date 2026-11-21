/**
 * The real app for the Node host's tests: SQLite and local storage in a scratch directory, with the
 * storage adapter's lifecycle counted (and, on request, failing) so a test can see that the host
 * tears the app down through its own lifecycle, exactly once.
 */
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { createLocalStorage } from "@storyshelf/core/storage/local";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import type { ShelfApp } from "../../app-types.ts";
import { createShelfApp } from "../../index.tsx";

export interface RealApp {
  readonly app: ShelfApp;
  /** How many times the app's teardown reached the adapters. */
  teardowns(): number;
  /** Remove the scratch directory. */
  cleanup(): void;
}

export interface RealAppOptions {
  /** Make the storage adapter's setup throw this message (a failed boot). */
  failSetup?: string;
}

/** A real app with counted adapter teardown. */
export function realApp(options: RealAppOptions = {}): RealApp {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-node-host-"));
  let teardowns = 0;
  const local = createLocalStorage(dir);
  const hooks = local.lifecycle;
  if (!hooks) {
    throw new Error("local storage has a lifecycle");
  }
  const storage: StorageAdapter = {
    ...local,
    lifecycle: {
      health: hooks.health,
      setup: async (ctx) => {
        if (options.failSetup !== undefined) {
          throw new Error(options.failSetup);
        }
        await hooks.setup(ctx);
      },
      teardown: async () => {
        teardowns += 1;
        await hooks.teardown();
      },
    },
  };
  const app = createShelfApp({
    database: createSqliteDatabase(join(dir, "shelf.db")),
    storage,
    logger: pino({ level: "silent" }),
    config: { scratchDir: dir },
  });
  return {
    app,
    teardowns: () => teardowns,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
