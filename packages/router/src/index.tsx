/**
 * StoryShelf router: compose database, storage, capture, auth, and git-host
 * adapters into a complete self-hosted visual-testing Hono server.
 */
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { ShelfOptions } from "@storyshelf/core/config";
import { requestId } from "hono/request-id";
import type { ShelfApp, ShelfContext, ShelfRouter } from "./app-types.ts";
import { setupCaptureQueue } from "./capture-setup.ts";
import { attachLifecycle, type LifecycleCell } from "./lifecycle.ts";
import {
  authGate,
  csrf,
  rateLimit,
  requestLogging,
  resolveRequestUser,
  storeScope,
} from "./middleware/index.ts";
import { initGate, type MiddlewareWiring } from "./middleware/init-gate.ts";
import { registerAdmin } from "./routers/admin.ts";
import { registerAssets } from "./routers/assets.ts";
import { registerAuth } from "./routers/auth.ts";
import { registerBuilds } from "./routers/builds.ts";
import { registerHealth, type HealthDeps } from "./routers/health.ts";
import { registerLabels } from "./routers/labels.ts";
import { registerMedia } from "./routers/media.ts";
import { registerMembers } from "./routers/members.ts";
import { registerProjects } from "./routers/projects.ts";
import { registerStatusConfigs } from "./routers/status-configs.ts";
import { registerStorybook } from "./routers/storybook.ts";
import { registerTokens } from "./routers/tokens.ts";
import { registerUiPages } from "./routers/ui.ts";
import { registerWebhooks } from "./routers/webhooks.ts";
import { resolveRuntime } from "./runtime.ts";

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

/** Register every API router, page set, and optional auth flow. */
function registerAllRoutes(app: ShelfApp, options: ShelfOptions, health: HealthDeps): void {
  registerApiRoutes(app, health);
  registerPageRoutes(app, options);
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

/** Package version injected at build via __PKG_VERSION__. */
function packageVersion(): string {
  return (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0";
}

/**
 * Public surface: the router and its types only.
 *
 * `createShelfRouter` plus the option/config types needed to call it. Adapter
 * interfaces live under `core/adapter/*`; runtime helpers under `core/logger`,
 * `core/capture`, `core/paths`, `core/urls`, `core/diff`; tables and row types
 * under `core/schema`. Importing the barrel must never pull Node-only modules
 * into edge bundles beyond what Hono itself needs.
 */
export type { ShelfOptions, ShelfConfig, UIConfig, BrandTheme } from "@storyshelf/core/config";
export type { ShelfApp, ShelfContext, ShelfLifecycle, ShelfRouter } from "./app-types.ts";
