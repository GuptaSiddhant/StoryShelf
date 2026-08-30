import { AsyncLocalStorage } from "node:async_hooks";

import type { Logger } from "pino";

import type { AuthUser } from "./adapters/auth.ts";
import type { CaptureQueue } from "./adapters/capture-queue.ts";
import type { DatabaseAdapter } from "./adapters/database.ts";
import type { GitProvider } from "./adapters/status.ts";
import type { StorageAdapter } from "./adapters/storage.ts";
import type { ShelfConfig, UIConfig } from "./config.ts";

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
  gitProviders: GitProvider[];
}

const storage = new AsyncLocalStorage<Store>();

export function runWithStore<T>(store: Store, fn: () => T): T {
  return storage.run(store, fn);
}

export function getStore(): Store {
  const store = storage.getStore();
  if (!store) {
    throw new Error("Store not available. Use runWithStore().");
  }
  return store;
}
