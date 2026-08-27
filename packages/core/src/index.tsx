import { Hono } from "hono";

import type { AuthUser } from "./adapters/auth.ts";
import { Queue } from "./capture/queue.ts";
import type { ShelfOptions } from "./config.ts";
import { registerAdmin } from "./routers/admin.ts";
import { registerBuilds } from "./routers/builds.ts";
import { registerLabels } from "./routers/labels.ts";
import { registerMembers } from "./routers/members.ts";
import { registerProjects } from "./routers/projects.ts";
import { registerTokens } from "./routers/tokens.ts";
import { registerUiPages } from "./routers/ui.ts";
import { runWithStore } from "./store.ts";

async function resolveUser(
  c: { req: { raw: Request; header: (name: string) => string | undefined } },
  options: ShelfOptions,
): Promise<AuthUser | null> {
  if (!options.auth) {
    return null;
  }
  if (c.req.header("authorization")) {
    return null;
  }
  return await options.auth.check(c.req.raw);
}

export function createShelfRouter(options: ShelfOptions): Hono {
  const app = new Hono();
  const config = options.config ?? {};
  const ui = options.ui ?? {};
  const logger = options.logger ?? console;
  const authEnabled = options.auth !== undefined;

  const queue = options.capture ? new Queue(config.captureConcurrency ?? 2) : null;

  let enqueueCapture: ((buildId: string) => Promise<void>) | undefined;
  if (queue && options.capture) {
    const capture = options.capture;
    enqueueCapture = async (buildId: string): Promise<void> => {
      await queue.run(async () => {
        await capture.run(buildId);
      });
    };
  }

  app.use("*", async (c, next) => {
    const user = await resolveUser(c, options);
    return runWithStore(
      { db: options.database, storage: options.storage, config, ui, logger, user, authEnabled, enqueueCapture },
      async () => {
        await next();
      },
    );
  });

  registerProjects(app);
  registerBuilds(app);
  registerLabels(app);
  registerMembers(app);
  registerTokens(app);
  registerAdmin(app);
  registerUiPages(app);

  return app;
}

export type { ShelfOptions, ShelfConfig, UIConfig, BrandTheme } from "./config.ts";
export type { DatabaseAdapter, ListOptions } from "./adapters/database.ts";
export type { StorageAdapter } from "./adapters/storage.ts";
export type { CaptureRunner, JobStatus } from "./adapters/capture-runner.ts";
export type { AuthAdapter, AuthUser, AuthCallback } from "./adapters/auth.ts";
export type { StatusAdapter, CheckStatus } from "./adapters/status.ts";
export type { LoggerAdapter } from "./adapters/logger.ts";
export type { DiffOptions, DiffResult } from "./diff/options.ts";
export type { Viewport, StoryEntry, StorySourceAdapter } from "./capture/adapter.ts";
export { diffImages } from "./diff/engine.ts";
export type { RenderedContent } from "./ui/document.tsx";
export { StorybookAdapter } from "./capture/storybook.ts";
export { runCapture, type CaptureContext, type RenderStory } from "./capture/pipeline.ts";
export { Queue } from "./capture/queue.ts";
export { Retention } from "./retention/purge.ts";
export { createUrlBuilder, type UrlBuilder } from "./urls.ts";
export { ulid, slugify } from "./utils/ulid.ts";
export { baselinePath, diffPath, screenshotPath, storybookDir, storybookZipPath } from "./utils/paths.ts";
export * from "./schema.ts";
export * from "./types.ts";