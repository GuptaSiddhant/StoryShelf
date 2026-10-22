import type { CaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { DesignProvider } from "@storyshelf/core/adapter/design";
import type { GitHostProvider } from "@storyshelf/core/adapter/git-host";
import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import type { Ai } from "@storyshelf/core/ai";
import { createCatalogLoader, type CatalogLoader } from "@storyshelf/core/capture";
import type { NotificationsConfig, ShelfConfig, UIConfig } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import type { AuthUser } from "@storyshelf/core/types";
import { AsyncLocalStorage } from "node:async_hooks";
import type { PublishService } from "./publish-setup.ts";

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
  /** Publishing: completion and the `publish` job queue (absent in hand-built stores). */
  publish?: PublishService;
  /** Explicit `testing.concurrency`; unset means sized from the hardware. */
  captureConcurrency?: number;
  gitHosts: GitHostProvider[];
  /** Design providers (Figma, …); empty when none is wired. */
  design: DesignProvider[];
  notifiers: NotifierProvider[];
  /** Brand/sender settings for outgoing notifications (`notifications.config`). */
  notificationsConfig?: NotificationsConfig;
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

/**
 * Whether this instance has `testing`: it captures and compares builds, so pages layer snapshot
 * data (screenshots, statuses, design links) onto what the catalog gives them. Without it the same
 * pages render from the published Storybook alone.
 */
export function testingEnabled(store: Store = getStore()): boolean {
  return store.enqueueCapture !== undefined;
}

/** The catalog loader pages read; hand-built stores without one get an uncached loader. */
export function catalogOf(store: Store = getStore()): CatalogLoader {
  return (
    store.publish?.catalog ??
    createCatalogLoader({ db: store.db, storage: store.storage, logger: store.logger })
  );
}
