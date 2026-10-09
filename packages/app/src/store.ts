import type { CaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { GitHostProvider } from "@storyshelf/core/adapter/git-host";
import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import type { Ai } from "@storyshelf/core/ai";
import type { ShelfConfig, UIConfig } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import type { AuthUser } from "@storyshelf/core/types";
import { AsyncLocalStorage } from "node:async_hooks";

/** Request-scoped dependencies and session state. */
export interface Store {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  config: ShelfConfig;
  ui: UIConfig;
  logger: Logger;
  user: AuthUser | null;
  authEnabled: boolean;
  /** Raw session cookie value ("default" when anonymous); binds CSRF tokens. */
  sessionId: string;
  enqueueCapture?: (buildId: string, reqId?: string) => Promise<void>;
  captureQueue?: CaptureQueue | null;
  gitHosts: GitHostProvider[];
  notifiers: NotifierProvider[];
  /** AI insights surface; absent ⇒ AI off site-wide. */
  ai?: Ai;
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
