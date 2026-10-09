import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
/** Explicit dependencies for insight work (requests and background jobs share them). */
import type { Ai } from "@storyshelf/core/ai";
import type { Logger } from "@storyshelf/core/logger";
import type { NotifyDeps } from "../notify.ts";
import { getStore } from "../store.ts";

/** Everything a job needs, captured while the request store is in scope. */
export interface InsightDeps {
  ai: Ai;
  db: DatabaseAdapter;
  storage: StorageAdapter;
  logger: Logger;
  notify: NotifyDeps;
}

/** Snapshot the current request store into explicit deps (null when AI is off). */
export function insightDepsFromStore(): InsightDeps | null {
  const store = getStore();
  if (!store.ai) {
    return null;
  }
  return {
    ai: store.ai,
    db: store.db,
    storage: store.storage,
    logger: store.logger,
    notify: store,
  };
}
