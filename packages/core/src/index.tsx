/**
 * StoryShelf core: compose database, storage, capture, auth, and git-host
 * adapters into a complete self-hosted visual-testing Hono server.
 */
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, Next } from "hono";
import { requestId } from "hono/request-id";
import type { CaptureQueue } from "./adapters/capture-queue.ts";
import {
  AdapterLifecycleError,
  collectCloses,
  collectInits,
  runAdapterCloses,
  runAdapterInits,
} from "./adapters/init.ts";
import type { AdapterInitResult } from "./adapters/init.ts";
import type {
  AdapterInitContext,
  AdapterMetadata,
  GitAdapterMetadata,
} from "./adapters/metadata.ts";
import { createDispatchJob } from "./capture/dispatch.ts";
import type { CaptureJobOptions } from "./capture/orchestrator.ts";
import { InMemoryCaptureQueue } from "./capture/queue.ts";
import type { ShelfOptions } from "./config.ts";
import { validateConfig, validateUiConfig } from "./config.ts";
import { createShelfLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";
import {
  authGate,
  csrf,
  rateLimit,
  requestLogging,
  resolveRequestUser,
  storeScope,
} from "./middleware/index.ts";
import { registerAdmin } from "./routers/admin.ts";
import { registerAssets } from "./routers/assets.ts";
import { registerAuth } from "./routers/auth.ts";
import { registerBuilds } from "./routers/builds.ts";
import { registerHealth } from "./routers/health.ts";
import type { HealthDeps } from "./routers/health.ts";
import { registerLabels } from "./routers/labels.ts";
import { registerMedia } from "./routers/media.ts";
import { registerMembers } from "./routers/members.ts";
import { registerProjects } from "./routers/projects.ts";
import { registerStatusConfigs } from "./routers/status-configs.ts";
import { registerStorybook } from "./routers/storybook.ts";
import { registerTokens } from "./routers/tokens.ts";
import { registerUiPages } from "./routers/ui.ts";
import { registerWebhooks } from "./routers/webhooks.ts";

/** Per-request shelf context (adapters, config, user, capture queue). */
export interface ShelfContext {
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
  gitHosts: import("./adapters/git-host/index.ts").GitHostProvider[];
}

/** Hono application type carrying the shelf context variables. */
export type ShelfApp = OpenAPIHono<{ Variables: ShelfContext }>;

/** App-scoped adapter lifecycle namespace (single `lifecycle` prop avoids Hono collisions). */
export interface ShelfLifecycle {
  /** Settled summary of the eager background init run; never rejects. */
  readonly ready: Promise<AdapterInitResult>;
  /**
   * Fail-fast await for server startup (`await app.lifecycle.init()`).
   * Re-runs init so transient failures are retryable; throws AdapterLifecycleError.
   * Optional — when skipped, the first request gates on `ready` instead.
   */
  init(): Promise<void>;
  /** Graceful teardown for SIGTERM/SIGINT (`await app.lifecycle.close()`). Idempotent. */
  close(): Promise<void>;
}

/** Hono app with the shelf lifecycle namespace attached. */
export type ShelfRouter = ShelfApp & { readonly lifecycle: ShelfLifecycle };

function addOptionalSnapshots(
  snap: Record<string, AdapterMetadata | GitAdapterMetadata>,
  options: ShelfOptions,
): void {
  if (options.captureRunner) {
    snap["captureRunner"] = options.captureRunner.metadata;
  }
  if (options.captureQueue) {
    snap["captureQueue"] = options.captureQueue.metadata;
  }
  if (options.auth) {
    snap["auth"] = options.auth.metadata;
  }
}

function buildAdapterSnapshot(
  options: ShelfOptions,
): Record<string, AdapterMetadata | GitAdapterMetadata> {
  const snap: Record<string, AdapterMetadata | GitAdapterMetadata> = {
    database: options.database.metadata,
    storage: options.storage.metadata,
  };
  addOptionalSnapshots(snap, options);
  for (const p of options.gitHosts ?? []) {
    snap[`git:${p.metadata.kind}`] = p.metadata;
  }
  return snap;
}

interface ServerRuntime {
  config: import("./config.ts").ShelfConfig;
  ui: import("./config.ts").UIConfig;
  logger: import("./logger.ts").Logger;
  authEnabled: boolean;
  gitHosts: import("./adapters/git-host/index.ts").GitHostProvider[];
}

/** Validate config/ui and derive runtime singletons from options. */
function resolveRuntime(options: ShelfOptions): ServerRuntime {
  // eslint-disable-next-line typescript/no-unnecessary-type-assertion -- ShelfConfig lacks index signature
  const rawConfig = options.config
    ? validateConfig(options.config as unknown as Record<string, unknown>)
    : {};
  // eslint-disable-next-line typescript/no-unnecessary-type-assertion -- UIConfig lacks index signature
  const ui = options.ui ? validateUiConfig(options.ui as unknown as Record<string, unknown>) : {};
  const logger = options.logger ?? createShelfLogger();
  const authEnabled = options.auth !== undefined;
  const gitHosts = options.gitHosts ?? [];
  // Adapter introspection — auto-populate config.adapters if not supplied
  const config: import("./config.ts").ShelfConfig = rawConfig.adapters
    ? rawConfig
    : {
        ...rawConfig,
        adapters: buildAdapterSnapshot(options),
      };
  return { config, ui, logger, authEnabled, gitHosts };
}

interface QueueWiring {
  queue: CaptureQueue | null;
  enqueueCapture: ((buildId: string, reqId?: string) => Promise<void>) | undefined;
}

/** Assemble the capture queue and its enqueue hook when a runner is configured. */
function setupCaptureQueue(
  options: ShelfOptions,
  config: import("./config.ts").ShelfConfig,
  gitHosts: import("./adapters/git-host/index.ts").GitHostProvider[],
  logger: import("./logger.ts").Logger,
): QueueWiring {
  if (!options.captureRunner) {
    return { queue: null, enqueueCapture: undefined };
  }
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
  const runJob = createDispatchJob({
    db: options.database,
    jobOptions,
    gitHosts,
    secret: config.secret,
    logger,
  });
  const captureQueue =
    options.captureQueue ??
    new InMemoryCaptureQueue({
      concurrency: config.captureConcurrency ?? 2,
      logger,
      runJob,
    });
  const enqueueCapture = async (buildId: string, reqId?: string): Promise<void> => {
    await captureQueue.enqueue({ buildId, reqId });
  };
  return { queue: captureQueue, enqueueCapture };
}

interface MiddlewareWiring extends ServerRuntime, QueueWiring {
  options: ShelfOptions;
  getReady: () => Promise<AdapterInitResult>;
}

/** Failures safe to expose on the init gate's 503 (no secrets). */
function publicFailures(
  result: AdapterInitResult,
): { category: string; kind: string; error: string }[] {
  return result.failures.map((failure) => ({
    category: failure.category,
    kind: failure.kind,
    error: failure.error,
  }));
}

/**
 * Block requests until adapter init settles; answer 503 with the per-adapter
 * failures when init failed. Health probes are exempt (they report init
 * state themselves instead of being masked by the gate).
 */
function initGate(getReady: () => Promise<AdapterInitResult>) {
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (c.req.path === "/api/v1/health") {
      await next();
      return;
    }
    const result = await getReady();
    if (!result.ok) {
      return c.json(
        { error: "Adapters failed to initialize", failures: publicFailures(result) },
        503,
      );
    }
    await next();
  };
}

/** Mutable init-settlement cell shared by the gate, health, and `init()`. */
interface LifecycleCell {
  ready: Promise<AdapterInitResult>;
  settled: AdapterInitResult | null;
}

function trackSettlement(cell: LifecycleCell, promise: Promise<AdapterInitResult>): void {
  promise.then(
    (result) => {
      cell.settled = result;
    },
    () => {
      cell.settled = { ok: false, failures: [] };
    },
  );
}

/** Kick the eager background init run (resolves; never rejects). */
function kickInit(
  options: ShelfOptions,
  ctx: AdapterInitContext,
  logger: Logger,
  cell: LifecycleCell,
): void {
  cell.ready = runAdapterInits(collectInits(options), ctx, logger);
  trackSettlement(cell, cell.ready);
}

/** Kick eager init and attach the `app.lifecycle` namespace (single run). */
function attachLifecycle(
  app: ShelfApp,
  options: ShelfOptions,
  runtime: ServerRuntime,
  cell: LifecycleCell,
): void {
  const initCtx: AdapterInitContext = { config: runtime.config, logger: runtime.logger };
  kickInit(options, initCtx, runtime.logger, cell);
  Object.assign(app, { lifecycle: createLifecycle(options, initCtx, runtime.logger, cell) });
}

/** Build the `app.lifecycle` namespace closing over one settlement cell. */
function createLifecycle(
  options: ShelfOptions,
  ctx: AdapterInitContext,
  logger: Logger,
  cell: LifecycleCell,
): ShelfLifecycle {
  return {
    get ready() {
      return cell.ready;
    },
    init: async () => {
      const result = await runAdapterInits(collectInits(options), ctx, logger);
      cell.ready = Promise.resolve(result);
      cell.settled = result;
      if (!result.ok) {
        throw new AdapterLifecycleError("init", result.failures);
      }
    },
    close: async () => {
      const result = await runAdapterCloses(collectCloses(options), ctx, logger);
      if (!result.ok) {
        throw new AdapterLifecycleError("close", result.failures);
      }
    },
  };
}

/** Attach global middleware: ids, logging, init gate, limits, store scope, auth gate. */
function wireMiddleware(app: ShelfApp, wiring: MiddlewareWiring): void {
  const { options, config, ui, logger, authEnabled, enqueueCapture, queue, gitHosts, getReady } =
    wiring;
  app.use("*", requestId());
  // Structured request logging. Uses a Hono-native middleware rather than
  // Pino-http, which expects a Node server response (`res.on`) incompatible
  // With Hono's Web `Request`/`Response` model.
  app.use("*", requestLogging(logger));
  app.use("*", initGate(getReady));
  app.use("/api/v1/*", rateLimit({ windowMs: 60_000, max: 100 }));
  app.use("/api/v1/tokens/*", rateLimit({ windowMs: 60_000, max: 10 }));
  app.use("/api/v1/webhooks/*", rateLimit({ windowMs: 60_000, max: 20 }));
  app.use("/projects/:slug/settings/*", csrf());
  app.use(
    "*",
    storeScope({
      db: options.database,
      storage: options.storage,
      config,
      ui,
      logger,
      authEnabled,
      enqueueCapture,
      captureQueue: queue,
      gitHosts,
      resolveUser: async (c) => await resolveRequestUser(c, options.auth),
    }),
  );
  app.use("*", authGate());
}

/** Register every JSON API router. */
function registerApiRoutes(app: ShelfApp, health: HealthDeps): void {
  registerProjects(app);
  registerBuilds(app);
  registerLabels(app);
  registerMedia(app);
  registerMembers(app);
  registerTokens(app);
  registerWebhooks(app);
  registerStatusConfigs(app);
  registerHealth(app, health);
  registerAdmin(app);
}

/** Register HTML pages, assets, and the optional auth flow. */
function registerPageRoutes(app: ShelfApp, options: ShelfOptions): void {
  if (options.auth) {
    registerAuth(app, options.auth);
  }
  registerAssets(app);
  registerStorybook(app);
  registerUiPages(app);
}

/** Register the OpenAPI document and interactive docs page. */
function registerDocs(app: ShelfApp): void {
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
}

/** Register every API router, page set, and optional auth flow. */
function registerAllRoutes(app: ShelfApp, options: ShelfOptions, health: HealthDeps): void {
  registerApiRoutes(app, health);
  registerPageRoutes(app, options);
}

/** Package version injected at build via __PKG_VERSION__. */
function packageVersion(): string {
  return (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0";
}

/**
 * Create the StoryShelf Hono router with all API routes and HTML pages.
 *
 * Adapter `init` hooks kick off eagerly in the background (the constructor
 * stays synchronous). Await `app.lifecycle.init()` before serving for
 * fail-fast startup, or let the first request gate on settlement.
 */
export function createShelfRouter(options: ShelfOptions): ShelfRouter {
  const app = new OpenAPIHono<{ Variables: ShelfContext }>() as ShelfRouter;
  const runtime = resolveRuntime(options);
  const cell: LifecycleCell = { ready: Promise.resolve({ ok: true, failures: [] }), settled: null };
  attachLifecycle(app, options, runtime, cell);
  const { queue, enqueueCapture } = setupCaptureQueue(
    options,
    runtime.config,
    runtime.gitHosts,
    runtime.logger,
  );
  wireMiddleware(app, {
    ...runtime,
    queue,
    enqueueCapture,
    options,
    getReady: async () => await cell.ready,
  });
  registerAllRoutes(app, options, {
    sources: options,
    getSettled: () => cell.settled,
    bootTimeMs: Date.now(),
    version: packageVersion(),
  });
  registerDocs(app);

  return app;
}

/**
 * Public surface: the router and its types only.
 *
 * `createShelfRouter` plus the option/config types needed to call it. Adapter
 * interfaces live under `core/adapter/*`; runtime helpers under `core/logger`,
 * `core/capture`, `core/paths`, `core/urls`, `core/diff`; tables and row types
 * under `core/schema`. Models and internal tooling (`store`, `middleware`,
 * `retention`, pages) have no public entry. Importing the barrel
 * must never pull the Hono router into bundles that do not serve it.
 */
export type { ShelfOptions, ShelfConfig, UIConfig, BrandTheme } from "./config.ts";
