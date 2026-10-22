import type { CaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { DesignProvider } from "@storyshelf/core/adapter/design";
import type { GitHostProvider } from "@storyshelf/core/adapter/git-host";
import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import type { Ai } from "@storyshelf/core/ai";
import type { NotificationsConfig, ShelfConfig, UIConfig } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import type { AuthUser } from "@storyshelf/core/types";
import type { Context, Next } from "hono";
import type { PublishService } from "../publish-setup.ts";
import { runWithStore } from "../store.ts";
import { sessionIdFrom } from "./csrf.ts";

/** Dependencies scoped into the request store for router handlers. */
export interface StoreScopeDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  config: ShelfConfig;
  ui: UIConfig;
  logger: Logger;
  authEnabled: boolean;
  testing: boolean;
  enqueueCapture?: (buildId: string, reqId?: string) => Promise<void>;
  captureQueue: CaptureQueue | null;
  /** This instance runs the capture jobs itself (the retry and compute-jobs UI applies). */
  capturesHere?: boolean;
  publish?: PublishService;
  captureConcurrency?: number;
  gitHosts: GitHostProvider[];
  design: DesignProvider[];
  notifiers: NotifierProvider[];
  notificationsConfig?: NotificationsConfig;
  ai?: Ai;
  resolveUser: (c: Context) => Promise<AuthUser | null>;
}

/** Hono middleware running downstream handlers inside the request store. */
export function storeScope(deps: StoreScopeDeps) {
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    const user = await deps.resolveUser(c);
    c.set("userId", user?.id ?? null);
    await runWithStore(
      {
        db: deps.db,
        storage: deps.storage,
        config: deps.config,
        ui: deps.ui,
        logger: deps.logger,
        user,
        authEnabled: deps.authEnabled,
        testing: deps.testing,
        sessionId: sessionIdFrom(c),
        enqueueCapture: deps.enqueueCapture,
        captureQueue: deps.captureQueue,
        capturesHere: deps.capturesHere,
        publish: deps.publish,
        captureConcurrency: deps.captureConcurrency,
        gitHosts: deps.gitHosts,
        design: deps.design,
        notifiers: deps.notifiers,
        notificationsConfig: deps.notificationsConfig,
        ai: deps.ai,
      },
      async () => {
        await next();
      },
    );
  };
}
