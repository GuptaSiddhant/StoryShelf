/**
 * StoryShelf core: compose database, storage, capture, auth, and git-host
 * adapters into a complete self-hosted visual-testing Hono server.
 */
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { requestId } from "hono/request-id";
import type { CaptureQueue } from "./adapters/capture-queue.ts";
import type { AdapterMetadata, GitAdapterMetadata } from "./adapters/metadata.ts";
import { createDispatchJob } from "./capture/dispatch.ts";
import type { CaptureJobOptions } from "./capture/orchestrator.ts";
import { InMemoryCaptureQueue } from "./capture/queue.ts";
import type { ShelfOptions } from "./config.ts";
import { validateConfig, validateUiConfig } from "./config.ts";
import { createShelfLogger } from "./logger.ts";
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

function buildAdapterSnapshot(
  options: ShelfOptions,
): Record<string, AdapterMetadata | GitAdapterMetadata> {
  const snap: Record<string, AdapterMetadata | GitAdapterMetadata> = {};
  const named: [string, AdapterMetadata | GitAdapterMetadata | undefined][] = [
    ["database", options.database.metadata],
    ["storage", options.storage.metadata],
    ["captureRunner", options.captureRunner?.metadata],
    ["captureQueue", options.captureQueue?.metadata],
    ["auth", options.auth?.metadata],
  ];
  for (const [key, metadata] of named) {
    if (metadata) {
      snap[key] = metadata;
    }
  }
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
}

/** Attach global middleware: ids, logging, limits, store scope, auth gate. */
function wireMiddleware(app: ShelfApp, wiring: MiddlewareWiring): void {
  const { options, config, ui, logger, authEnabled, enqueueCapture, queue, gitHosts } = wiring;
  app.use("*", requestId());
  // Structured request logging. Uses a Hono-native middleware rather than
  // Pino-http, which expects a Node server response (`res.on`) incompatible
  // With Hono's Web `Request`/`Response` model.
  app.use("*", requestLogging(logger));
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
function registerApiRoutes(app: ShelfApp): void {
  registerProjects(app);
  registerBuilds(app);
  registerLabels(app);
  registerMedia(app);
  registerMembers(app);
  registerTokens(app);
  registerWebhooks(app);
  registerStatusConfigs(app);
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

/** Register every API router, page set, and optional auth flow. */
function registerAllRoutes(app: ShelfApp, options: ShelfOptions): void {
  registerApiRoutes(app);
  registerPageRoutes(app, options);
}

/** Create the StoryShelf Hono router with all API routes and HTML pages. */
export function createShelfRouter(options: ShelfOptions): ShelfApp {
  const app = new OpenAPIHono<{ Variables: ShelfContext }>();
  const runtime = resolveRuntime(options);
  const { queue, enqueueCapture } = setupCaptureQueue(
    options,
    runtime.config,
    runtime.gitHosts,
    runtime.logger,
  );
  wireMiddleware(app, { ...runtime, queue, enqueueCapture, options });
  registerAllRoutes(app, options);

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
