import type { AuthUser } from "@storyshelf/core/adapter/auth";
import type { CaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { GitHostProvider } from "@storyshelf/core/adapter/git-host";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import type { ShelfConfig, UIConfig } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import type { Context, Next } from "hono";
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
