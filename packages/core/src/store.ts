import { AsyncLocalStorage } from "node:async_hooks";

import type { Logger } from "pino";

import type { AuthUser } from "./adapters/auth.ts";
import type { CaptureQueue } from "./adapters/capture-queue.ts";
import type { DatabaseAdapter } from "./adapters/database.ts";
import type { GitHostProvider } from "./adapters/git-host/index.ts";
import type { StorageAdapter } from "./adapters/storage.ts";
import type { ShelfConfig, UIConfig } from "./config.ts";

/** Request-scoped dependencies and session state. */
export interface Store {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  config: ShelfConfig;
  ui: UIConfig;
  logger: Logger;
  user: AuthUser | null;
  authEnabled: boolean;
  enqueueCapture?: (buildId: string, reqId?: string) => Promise<void>;
  captureQueue?: CaptureQueue | null;
  gitHosts: GitHostProvider[];
}

const storage = new AsyncLocalStorage<Store>();

/** Run a function with the given request store in scope. */
export function runWithStore<T>(store: Store, fn: () => T): T {
  return storage.run(store, fn);
}

/** Return the current request store, throwing outside a request scope. */
export function getStore(): Store {
  const store = storage.getStore();
  if (!store) {
    throw new Error("Store not available. Use runWithStore().");
  }
  return store;
}
