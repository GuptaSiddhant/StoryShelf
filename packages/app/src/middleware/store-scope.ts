import type { CaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import type { CaptureRunner } from "@storyshelf/core/adapter/capture-runner";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { DesignProvider } from "@storyshelf/core/adapter/design";
import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import type { Ai } from "@storyshelf/core/ai";
import type { BuildStatePublisher } from "@storyshelf/core/build-state";
import type { NotificationsConfig, ShelfConfig, UIConfig } from "@storyshelf/core/config";
import type { GitLinkConfig, IntegrationStatus } from "@storyshelf/core/integrations";
import type { Logger } from "@storyshelf/core/logger";
import type { GitConnectionModel, PublicOriginResolver } from "@storyshelf/core/models";
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
  /** `options.skippedBuilds` is on (ADR 0044). */
  skippedBuilds?: boolean;
  enqueueCapture?: (buildId: string, reqId?: string) => Promise<void>;
  captureQueue: CaptureQueue | null;
  /** This instance runs the capture jobs itself (the retry and compute-jobs UI applies). */
  capturesHere?: boolean;
  publish?: PublishService;
  cancelBuildJobs?: (buildId: string) => Promise<boolean>;
  buildState?: BuildStatePublisher;
  captureConcurrency?: number;
  runner?: Pick<CaptureRunner, "metadata" | "images"> | undefined;
  publicOrigin?: PublicOriginResolver | undefined;
  design: DesignProvider[];
  notifiers: NotifierProvider[];
  integrations?: readonly IntegrationStatus[];
  gitConfiguredLinks?: readonly GitLinkConfig[] | undefined;
  notificationsConfig?: NotificationsConfig;
  ai?: Ai;
  gitConnections?: GitConnectionModel;
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
        skippedBuilds: deps.skippedBuilds === true,
        sessionId: sessionIdFrom(c),
        enqueueCapture: deps.enqueueCapture,
        captureQueue: deps.captureQueue,
        capturesHere: deps.capturesHere,
        publish: deps.publish,
        cancelBuildJobs: deps.cancelBuildJobs,
        buildState: deps.buildState,
        captureConcurrency: deps.captureConcurrency,
        runner: deps.runner,
        publicOrigin: deps.publicOrigin,
        design: deps.design,
        notifiers: deps.notifiers,
        integrations: deps.integrations,
        gitConfiguredLinks: deps.gitConfiguredLinks,
        notificationsConfig: deps.notificationsConfig,
        ai: deps.ai,
        gitConnections: deps.gitConnections,
      },
      async () => {
        await next();
      },
    );
  };
}
