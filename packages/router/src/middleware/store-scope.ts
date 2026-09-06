import type { Context, Next } from "hono";
import type { AuthUser } from "../adapters/auth.ts";
import type { CaptureQueue } from "../adapters/capture-queue.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { GitHostProvider } from "../adapters/git-host/index.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { ShelfConfig, UIConfig } from "../config.ts";
import type { Logger } from "../logger.ts";
import { runWithStore } from "../store.ts";

/** Dependencies scoped into the request store for router handlers. */
export interface StoreScopeDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  config: ShelfConfig;
  ui: UIConfig;
  logger: Logger;
  authEnabled: boolean;
  enqueueCapture?: (buildId: string, reqId?: string) => Promise<void>;
  captureQueue: CaptureQueue | null;
  gitHosts: GitHostProvider[];
  resolveUser: (c: Context) => Promise<AuthUser | null>;
}

/** Hono middleware running downstream handlers inside the request store. */
export function storeScope(deps: StoreScopeDeps) {
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    const user = await deps.resolveUser(c);
    await runWithStore(
      {
        db: deps.db,
        storage: deps.storage,
        config: deps.config,
        ui: deps.ui,
        logger: deps.logger,
        user,
        authEnabled: deps.authEnabled,
        enqueueCapture: deps.enqueueCapture,
        captureQueue: deps.captureQueue,
        gitHosts: deps.gitHosts,
      },
      async () => {
        await next();
      },
    );
  };
}
