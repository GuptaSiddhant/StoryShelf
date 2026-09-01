import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { requestId } from "hono/request-id";
import type { AuthUser } from "./adapters/auth.ts";
import type { CaptureQueue } from "./adapters/capture-queue.ts";
import type { ShelfOptions } from "./config.ts";
import type { AdapterMetadata, GitAdapterMetadata } from "./adapters/metadata.ts";
import { validateConfig, validateUiConfig } from "./config.ts";
import { createShelfLogger } from "./logger.ts";
import { csrf, rateLimit } from "./middleware/index.ts";
import { BuildModel } from "./models/build.ts";
import { ProjectModel } from "./models/project.ts";
import { registerAdmin } from "./routers/admin.ts";
import { registerAssets } from "./routers/assets.ts";
import { registerAuth } from "./routers/auth.ts";
import { registerBuilds } from "./routers/builds.ts";
import { registerLabels } from "./routers/labels.ts";
import { registerMedia } from "./routers/media.ts";
import { registerMembers } from "./routers/members.ts";
import { registerProjects } from "./routers/projects.ts";
import { registerStatusConfigs } from "./routers/status-configs.ts";
import { registerTokens } from "./routers/tokens.ts";
import { registerUiPages } from "./routers/ui.ts";
import { registerWebhooks } from "./routers/webhooks.ts";
import { getStore, runWithStore } from "./store.ts";
import { executeCaptureJob, type CaptureJobOptions } from "./capture/orchestrator.ts";
import { InMemoryCaptureQueue } from "./capture/queue.ts";
import { postStatusesForBuild } from "./capture/status-fanout.ts";

export type ShelfContext = {
  requestId?: string;
  db: import("./adapters/database.ts").DatabaseAdapter;
  storage: import("./adapters/storage.ts").StorageAdapter;
  config: import("./config.ts").ShelfConfig;
  ui: import("./config.ts").UIConfig;
  logger: ReturnType<typeof createShelfLogger>;
  user: import("./adapters/auth.ts").AuthUser | null;
  authEnabled: boolean;
  enqueueCapture?: (buildId: string, reqId?: string) => Promise<void>;
  captureQueue: import("./adapters/capture-queue.ts").CaptureQueue | null;
  gitProviders: import("./adapters/status.ts").GitAdapter[];
};

export type ShelfApp = OpenAPIHono<{ Variables: ShelfContext }>;

function buildAdapterSnapshot(options: ShelfOptions): Record<string, AdapterMetadata | GitAdapterMetadata> {
  const snap: Record<string, AdapterMetadata | GitAdapterMetadata> = {};
  if (options.database.metadata) snap["database"] = options.database.metadata;
  if (options.storage.metadata) snap["storage"] = options.storage.metadata;
  if (options.captureRunner?.metadata) snap["captureRunner"] = options.captureRunner.metadata;
  if (options.captureQueue?.metadata) snap["captureQueue"] = options.captureQueue.metadata;
  if (options.auth?.metadata) snap["auth"] = options.auth.metadata;
  for (const p of options.gitProviders ?? []) {
    snap[`git:${p.metadata.kind}`] = p.metadata;
  }
  return snap;
}

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


export function createShelfRouter(options: ShelfOptions): ShelfApp {
  const app = new OpenAPIHono<{ Variables: ShelfContext }>();
  // eslint-disable-next-line typescript/no-unnecessary-type-assertion -- ShelfConfig lacks index signature
  const rawConfig = options.config ? validateConfig(options.config as unknown as Record<string, unknown>) : {};
  // eslint-disable-next-line typescript/no-unnecessary-type-assertion -- UIConfig lacks index signature
  const ui = options.ui ? validateUiConfig(options.ui as unknown as Record<string, unknown>) : {};
  const logger = options.logger ?? createShelfLogger();
  const authEnabled = options.auth !== undefined;

  const gitProviders = options.gitProviders ?? [];

  // Adapter introspection — auto-populate config.adapters if not supplied
  const config: import("./config.ts").ShelfConfig = rawConfig.adapters
    ? rawConfig
    : {
        ...rawConfig,
        adapters: buildAdapterSnapshot(options),
      };

  let queue: CaptureQueue | null = null;
  let enqueueCapture: ((buildId: string, reqId?: string) => Promise<void>) | undefined;
  if (options.captureRunner) {
    if (!config.scratchDir) {
      throw new Error("captureRunner is enabled but ShelfConfig.scratchDir is not set");
    }
    const jobOptions: CaptureJobOptions = {
      db: options.database,
      storage: options.storage,
      runner: options.captureRunner,
      scratchDir: config.scratchDir,
      viewports: config.viewports,
      logger,
    };
    const captureQueue =
      options.captureQueue ??
      new InMemoryCaptureQueue({
        concurrency: config.captureConcurrency ?? 2,
        logger,
        runJob: async (job): Promise<void> => {
          const builds = new BuildModel(options.database);
          const build = await builds.get(job.buildId);
          if (!build) {
            await executeCaptureJob({ buildId: job.buildId, reqId: job.reqId }, jobOptions);
            return;
          }
          const project = await new ProjectModel(options.database).get(build.projectId);
          if (!project) {
            await executeCaptureJob({ buildId: job.buildId, reqId: job.reqId }, jobOptions);
            return;
          }
          const pendingUrl = `/projects/${project.slug}/builds/${job.buildId}`;
          await postStatusesForBuild({
            db: options.database,
            project,
            sha: build.gitSha,
            status: "pending",
            url: pendingUrl,
            providers: gitProviders,
            secret: config.secret,
            logger,
          }).catch((error: unknown) => {
            logger.error({ err: error }, "failed to post pending status");
          });
          try {
            await executeCaptureJob({ buildId: job.buildId, reqId: job.reqId }, jobOptions);
            const updated = await builds.get(job.buildId);
            if (updated) {
              const terminal =
                updated.status === "approved"
                  ? "success"
                  : updated.status === "rejected" || updated.status === "failed"
                    ? "failure"
                    : null;
              if (terminal) {
                await postStatusesForBuild({
                  db: options.database,
                  project,
                  sha: updated.gitSha,
                  status: terminal,
                  url: pendingUrl,
                  providers: gitProviders,
                  secret: config.secret,
                  logger,
                }).catch((error: unknown) => {
                  logger.error({ err: error }, "failed to post terminal status");
                });
              }
            }
          } catch (error: unknown) {
            await postStatusesForBuild({
              db: options.database,
              project,
              sha: build.gitSha,
              status: "failure",
              url: pendingUrl,
              providers: gitProviders,
              secret: config.secret,
              logger,
            }).catch(() => {
              // ignore: status post failure already logged
            });
            throw error;
          }
        },
      });
    queue = captureQueue;
    enqueueCapture = async (buildId: string, reqId?: string): Promise<void> => {
      await captureQueue.enqueue({ buildId, reqId });
    };
  }

  app.use("*", requestId());

  // Structured request logging. Uses a Hono-native middleware rather than
  // pino-http, which expects a Node server response (`res.on`) incompatible
  // with Hono's Web `Request`/`Response` model.
  app.use("*", async (c, next) => {
    const started = performance.now();
    const id = c.get("requestId");
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

  app.use("/api/v1/*", rateLimit({ windowMs: 60_000, max: 100 }));
  app.use("/api/v1/tokens/*", rateLimit({ windowMs: 60_000, max: 10 }));
  app.use("/api/v1/webhooks/*", rateLimit({ windowMs: 60_000, max: 20 }));
  app.use("/projects/:slug/settings/*", csrf());

  app.use("*", async (c, next) => {
    const user = await resolveUser(c, options);
    return runWithStore(
      {
        db: options.database,
        storage: options.storage,
        config,
        ui,
        logger,
        user,
        authEnabled,
        enqueueCapture,
        captureQueue: queue,
        gitProviders,
      },
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
    if (
      !isAuthEnabled ||
      user ||
      path.startsWith("/api/") ||
      path.startsWith("/auth/") ||
      path.startsWith("/assets/")
    ) {
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
  registerStatusConfigs(app);
  registerAdmin(app);
  if (options.auth) {
    registerAuth(app, options.auth);
  }
  registerAssets(app);
  registerUiPages(app);

  app.doc("/api/v1/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "StoryShelf API",
      description:
        "REST API for the StoryShelf visual testing platform. JSON endpoints live under /api/v1; HTML pages are served at /.",
      version: "1.0.0",
    },
  });
  app.get("/api/v1/docs", swaggerUI({ url: "/api/v1/openapi.json" }));

  return app;
}

export type { ShelfOptions, ShelfConfig, UIConfig, BrandTheme } from "./config.ts";
export type { DatabaseAdapter, ListOptions } from "./adapters/database.ts";
export type { StorageAdapter } from "./adapters/storage.ts";
export type {
  CaptureRunner,
  JobStatus,
  RenderedSnapshot,
  RenderResult,
  RenderFailure,
} from "./adapters/capture-runner.ts";
export type { CaptureQueue, CaptureJob, QueueEntry } from "./adapters/capture-queue.ts";
export type { AuthAdapter, AuthUser, AuthCallback } from "./adapters/auth.ts";
export type { GitAdapter, CheckStatus } from "./adapters/status.ts";
export type { AdapterMetadata, GitAdapterMetadata } from "./adapters/metadata.ts";
export type { DiffOptions, DiffResult } from "./diff/options.ts";
export type { Viewport, StoryEntry, StorySourceAdapter } from "./capture/adapter.ts";
export { createShelfLogger, type LoggerOptions, type PinoTransport } from "./logger.ts";
export { diffImages } from "./diff/engine.ts";
export type { RenderedContent } from "./ui/document.tsx";
export { StorybookAdapter } from "./capture/storybook.ts";
export { persistCapture, type CaptureContext } from "./capture/pipeline.ts";
export { executeCaptureJob, type CaptureJobOptions } from "./capture/orchestrator.ts";
export { DEFAULT_VIEWPORTS } from "./capture/adapter.ts";
export { InMemoryCaptureQueue, type InMemoryCaptureQueueOptions } from "./capture/queue.ts";
export { Retention } from "./retention/purge.ts";
export { createUrlBuilder, type UrlBuilder } from "./urls.ts";
export { ulid, slugify } from "./utils/ulid.ts";
export {
  baselinePath,
  diffPath,
  screenshotPath,
  storybookDir,
  storybookZipPath,
} from "./utils/paths.ts";
export * from "./schema.ts";
export * from "./types.ts";
