import { Hono } from "hono";
import { requestId } from "hono/request-id";

import type { AuthUser } from "./adapters/auth.ts";
import { Queue } from "./capture/queue.ts";
import type { ShelfOptions } from "./config.ts";
import { createShelfLogger } from "./logger.ts";
import { registerAdmin } from "./routers/admin.ts";
import { registerAssets } from "./routers/assets.ts";
import { registerAuth } from "./routers/auth.ts";
import { registerBuilds } from "./routers/builds.ts";
import { registerLabels } from "./routers/labels.ts";
import { registerMedia } from "./routers/media.ts";
import { registerMembers } from "./routers/members.ts";
import { registerProjects } from "./routers/projects.ts";
import { registerTokens } from "./routers/tokens.ts";
import { registerUiPages } from "./routers/ui.ts";
import { registerWebhooks } from "./routers/webhooks.ts";
import { getStore, runWithStore } from "./store.ts";

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
  const logger = options.logger ?? createShelfLogger();
  const authEnabled = options.auth !== undefined;

  const queue = options.capture ? new Queue(config.captureConcurrency ?? 2, logger) : null;

  let enqueueCapture: ((buildId: string, reqId?: string) => Promise<void>) | undefined;
  if (queue && options.capture) {
    const capture = options.capture;
    enqueueCapture = async (buildId: string, reqId?: string): Promise<void> => {
      await queue.run(buildId, reqId, async () => {
        await capture.run(buildId, reqId);
      });
    };
  }

  app.use("*", requestId());

  // Structured request logging. Uses a Hono-native middleware rather than
  // pino-http, which expects a Node server response (`res.on`) incompatible
  // with Hono's Web `Request`/`Response` model.
  app.use("*", async (c, next) => {
    const started = performance.now();
    const id = c.get("requestId") as string | undefined;
    logger.info({ reqId: id, method: c.req.method, url: c.req.path }, "request start");
    await next();
    logger.info(
      {
        reqId: id,
        method: c.req.method,
        url: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
      },
      "request end",
    );
  });

  app.use("*", async (c, next) => {
    const user = await resolveUser(c, options);
    return runWithStore(
      { db: options.database, storage: options.storage, config, ui, logger, user, authEnabled, enqueueCapture, captureQueue: queue },
      async () => {
        await next();
      },
    );
  });

// Gate the server-rendered UI behind auth (ADR 0008): unauthenticated HTML
  // requests are redirected to the login page. API and auth routes are handled
  // by their own routers (401/403 vs the login flow).
  // eslint-disable-next-line require-await -- async is required to match Hono's middleware signature
  app.use("*", async (c, next) => {
    const { user, authEnabled: isAuthEnabled } = getStore();
    const path = c.req.path;
    if (!isAuthEnabled || user || path.startsWith("/api/") || path.startsWith("/auth/") || path.startsWith("/assets/")) {
      return next();
    }
    if (c.req.header("HX-Request") === "true") {
      c.header("HX-Redirect", "/auth/login");
      return c.body(null, 204);
    }
    return c.redirect("/auth/login", 302);
  });

  registerProjects(app);
  registerBuilds(app);
  registerLabels(app);
  registerMedia(app);
  registerMembers(app);
  registerTokens(app);
  registerWebhooks(app);
  registerAdmin(app);
  if (options.auth) {
    registerAuth(app, options.auth);
  }
  registerAssets(app);
  registerUiPages(app);

  return app;
}

export type { ShelfOptions, ShelfConfig, UIConfig, BrandTheme } from "./config.ts";
export type { DatabaseAdapter, ListOptions } from "./adapters/database.ts";
export type { StorageAdapter } from "./adapters/storage.ts";
export type { CaptureRunner, JobStatus } from "./adapters/capture-runner.ts";
export type { AuthAdapter, AuthUser, AuthCallback } from "./adapters/auth.ts";
export type { StatusAdapter, CheckStatus } from "./adapters/status.ts";
export type { DiffOptions, DiffResult } from "./diff/options.ts";
export type { Viewport, StoryEntry, StorySourceAdapter } from "./capture/adapter.ts";
export { createShelfLogger, type LoggerOptions, type PinoTransport } from "./logger.ts";
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