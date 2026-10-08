import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { AdapterLifecycleError, validateBootAssembly } from "@storyshelf/core/adapter/setup";
import type { ShelfConfig, ShelfOptions } from "@storyshelf/core/config";
/**
 * StoryShelf app: compose database, storage, capture, auth, and git-host
 * adapters into a complete self-hosted visual-testing Hono app.
 */
import type { Logger } from "@storyshelf/core/logger";
import {
  createHttpMiddleware,
  createInstrumentedDatabase,
  createInstrumentedStorage,
} from "@storyshelf/observability";
import { requestId } from "hono/request-id";
import type { ShelfApp, ShelfContext, ShelfRouter } from "./app-types.ts";
import { setupCaptureQueue } from "./capture-setup.ts";
import { checkCredentialsAfterSetup } from "./credentials.ts";
import { attachLifecycle, trackBackground, type LifecycleCell } from "./lifecycle.ts";
import {
  authGate,
  csrf,
  rateLimit,
  rateLimitKey,
  requestLogging,
  resolveRequestUser,
  storeScope,
} from "./middleware/index.ts";
import { serverTiming } from "./middleware/server-timing.ts";
import { setupGate, type MiddlewareWiring } from "./middleware/setup-gate.ts";
import { registerAdminPages } from "./routers/admin-pages.ts";
import { registerAdmin } from "./routers/admin.ts";
import { registerAssets } from "./routers/assets.ts";
import { registerEngineAuth } from "./routers/auth.ts";
import { registerBuilds } from "./routers/builds.ts";
import { registerHealth, type HealthDeps } from "./routers/health.ts";
import { registerLabels } from "./routers/labels.ts";
import { registerMedia } from "./routers/media.ts";
import { registerMembers } from "./routers/members.ts";
import {
  registerNotificationChannels,
  registerSystemChannels,
} from "./routers/notification-channels.ts";
import { registerNotificationSubscriptions } from "./routers/notification-subscriptions.ts";
import { registerProfile } from "./routers/profile.ts";
import { registerProjects } from "./routers/projects.ts";
import { registerStatusConfigs } from "./routers/status-configs.ts";
import { registerStorybook } from "./routers/storybook.ts";
import { registerTokens } from "./routers/tokens.ts";
import { registerUiPages } from "./routers/ui.ts";
import { registerWebhooks } from "./routers/webhooks.ts";
import { registerWellKnown } from "./routers/well-known.ts";
import { resolveRuntime } from "./runtime.ts";

/**
 * Fail fast on third-party adapters that cannot satisfy their slot.
 * Throws before any route or lifecycle hook runs.
 */
function throwOnInvalidAdapters(options: ShelfOptions): void {
  const invalid = validateBootAssembly(options);
  if (invalid.length > 0) {
    throw new AdapterLifecycleError("setup", invalid);
  }
}

/** Request/capture-path adapters with OTEL wrappers (lifecycle keeps raw ones). */
function instrumentedOptions(options: ShelfOptions): ShelfOptions {
  return {
    ...options,
    database: createInstrumentedDatabase(options.database),
    storage: createInstrumentedStorage(options.storage),
  };
}

/** Once adapters are ready, requeue-once or fail builds a restart left `capturing`. */
function recoverAfterSetup(
  cell: LifecycleCell,
  recoverStuck: (() => Promise<unknown>) | undefined,
  logger: Logger,
): void {
  if (!recoverStuck) {
    return;
  }
  trackBackground(
    cell,
    cell.ready
      .then(async (setup) => {
        if (setup.ok) {
          await recoverStuck();
        }
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, "stuck capture recovery failed");
      }),
  );
}

/** Boot-time checks that run once adapters are ready: stuck-capture recovery and credential state. */
function runAfterSetup(
  cell: LifecycleCell,
  scoped: ShelfOptions,
  runtime: ReturnType<typeof resolveRuntime>,
  recoverStuck: (() => Promise<unknown>) | undefined,
): void {
  recoverAfterSetup(cell, recoverStuck, runtime.logger);
  checkCredentialsAfterSetup(cell, scoped.database, runtime.config, runtime.logger);
}

/** Attach lifecycle, queue, middleware, routes, and docs to the app. */
function assembleApp(app: ShelfApp, options: ShelfOptions, scoped: ShelfOptions): void {
  const runtime = resolveRuntime(options);
  const cell: LifecycleCell = { ready: Promise.resolve({ ok: true, failures: [] }), settled: null };
  attachLifecycle(app, options, runtime, cell);
  if (runtime.config.serverTiming === true) {
    app.use("*", serverTiming(true));
  }
  const { queue, enqueueCapture, recoverStuck } = setupCaptureQueue(
    scoped,
    runtime.config,
    runtime.gitHosts,
    runtime.logger,
  );
  runAfterSetup(cell, scoped, runtime, recoverStuck);
  wireMiddleware(app, {
    ...runtime,
    queue,
    enqueueCapture,
    options: scoped,
    getReady: async () => await cell.ready,
  });
  registerAllRoutes(app, options, {
    sources: options,
    getSettled: () => cell.settled,
    bootTimeMs: Date.now(),
    version: packageVersion(),
  });
  registerDocs(app);
}

/**
 * Create the StoryShelf Hono app with all API routes and HTML pages.
 *
 * Adapter `init` hooks kick off eagerly in the background (the constructor
 * stays synchronous). Await `app.lifecycle.setup()` before serving for
 * fail-fast startup, or let the first request gate on settlement.
 */
export function createShelfApp(options: ShelfOptions): ShelfApp {
  throwOnInvalidAdapters(options);
  const app = new OpenAPIHono<{ Variables: ShelfContext }>() as ShelfApp;
  assembleApp(app, options, instrumentedOptions(options));

  return app;
}

/** Cookie-authenticated write paths guarded by CSRF tokens. */
const CSRF_PATHS = [
  "/auth/logout",
  "/auth/invites/*",
  "/projects/:slug/settings/*",
  "/profile/*",
  "/profile",
  "/admin/credentials/*",
] as const;

/** Attach global middleware: ids, logging, init gate, limits, store scope, auth gate. */
function wireMiddleware(app: ShelfRouter, wiring: MiddlewareWiring): void {
  const { config, logger, getReady } = wiring;
  app.use("*", requestId());
  // OTEL server spans (W3C extraction, route-template naming). Mounted right
  // after requestId so `storyshelf.req_id` resolves; `enduser.id` resolves
  // once storeScope runs downstream. Noop without an SDK.
  app.use(
    "*",
    createHttpMiddleware({ serviceName: "storyshelf", serviceVersion: packageVersion() }),
  );
  // Structured request logging. Uses a Hono-native middleware rather than
  // Pino-http, which expects a Node server response (`res.on`) incompatible
  // With Hono's Web `Request`/`Response` model.
  app.use("*", requestLogging(logger));
  app.use("*", setupGate(getReady));
  mountGuards(app, config);
  mountNotificationLimits(app);
  mountStoreScope(app, wiring);
  app.use("*", authGate());
}

/** Mount rate limits and CSRF guards (abuse floors, not strict protection). */
function mountGuards(app: ShelfRouter, config: ShelfConfig): void {
  app.use("/api/v1/*", rateLimit({ windowMs: 60_000, max: 100 }));
  app.use("/api/v1/tokens/*", rateLimit({ windowMs: 60_000, max: 10 }));
  app.use("/api/v1/webhooks/*", rateLimit({ windowMs: 60_000, max: 20 }));
  // Auth endpoints ride their own buckets (the shared store keys by IP, so
  // prefix the key: login floods must not eat the API budget or vice versa).
  app.use("/auth/*", rateLimit({ windowMs: 60_000, max: 100, keyGenerator: rateLimitKey("auth") }));
  app.use(
    "/api/auth/*",
    rateLimit({ windowMs: 60_000, max: 300, keyGenerator: rateLimitKey("engine") }),
  );
  for (const path of CSRF_PATHS) {
    app.use(path, csrf(config.secret));
  }
}

/** Abuse floors for notification management endpoints (own counters). */
function mountNotificationLimits(app: ShelfRouter): void {
  const channel = { windowMs: 60_000, max: 20, keyGenerator: rateLimitKey("notify-channels") };
  const admin = { windowMs: 60_000, max: 20, keyGenerator: rateLimitKey("notify-admin") };
  const subscription = { windowMs: 60_000, max: 30, keyGenerator: rateLimitKey("notify-subs") };
  app.use("/api/v1/projects/:slug/notification-channels", rateLimit(channel));
  app.use("/api/v1/projects/:slug/notification-channels/:channelId", rateLimit(channel));
  app.use("/api/v1/projects/:slug/notifications", rateLimit(subscription));
  app.use("/api/v1/projects/:slug/notifications/me", rateLimit(subscription));
  app.use("/api/v1/admin/notification-channels", rateLimit(admin));
  app.use("/api/v1/admin/notification-channels/:channelId", rateLimit(admin));
}

/** Mount the request-scoped store (db/storage/config/user/adapters). */
function mountStoreScope(app: ShelfRouter, wiring: MiddlewareWiring): void {
  const { options, config, ui, logger, authEnabled, enqueueCapture, queue, gitHosts, notifiers } =
    wiring;
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
      notifiers,
      resolveUser: async (c) => await resolveRequestUser(c, options.auth),
    }),
  );
}

/** Register every JSON API router. */
function registerApiRoutes(app: ShelfRouter, health: HealthDeps): void {
  registerProjectRoutes(app);
  registerNotificationRoutes(app);
  registerStatusConfigs(app);
  registerHealth(app, health);
  registerAdmin(app);
}

/** Register the per-project resource routers. */
function registerProjectRoutes(app: ShelfRouter): void {
  registerProjects(app);
  registerBuilds(app);
  registerLabels(app);
  registerMedia(app);
  registerMembers(app);
  registerTokens(app);
  registerWebhooks(app);
}

/** Register the notification channel and subscription routers. */
function registerNotificationRoutes(app: ShelfRouter): void {
  registerNotificationChannels(app);
  registerNotificationSubscriptions(app);
  registerSystemChannels(app);
}

/** Register the auth flow: engine mount, relying-party documents, profile. */
function registerAuthFlow(app: ShelfRouter, options: ShelfOptions): void {
  // Auth-gated pages mount only with auth: authEnabled=false mounts zero
  // auth routes. Static imports stay — true lazy loading would need an async
  // createShelfApp, which the sync Hono assembly cannot do.
  if (!options.auth) {
    return;
  }
  registerEngineAuth(app, options.auth);
  registerWellKnown(app, options.auth);
  registerProfile(app, options.auth);
}

/** Register HTML pages, assets, and the optional auth flow. */
function registerPageRoutes(app: ShelfRouter, options: ShelfOptions, health: HealthDeps): void {
  registerAuthFlow(app, options);
  registerAssets(app);
  registerStorybook(app);
  registerAdminPages(app, health, options.auth);
  registerUiPages(app);
}

/** Register every API router, page set, and optional auth flow. */
function registerAllRoutes(app: ShelfRouter, options: ShelfOptions, health: HealthDeps): void {
  registerApiRoutes(app, health);
  registerPageRoutes(app, options, health);
}

/** Register the OpenAPI document and interactive docs page. */
function registerDocs(app: ShelfRouter): void {
  app.doc("/api/v1/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "StoryShelf API",
      description:
        "REST API for the StoryShelf visual testing platform. JSON endpoints live under /api/v1; HTML pages are served at /.",
      version: "1.0.0",
    },
    tags: [
      {
        name: "Projects",
        description: "Create and manage projects (one project is one Storybook).",
      },
      {
        name: "Builds",
        description: "Upload Storybook builds, inspect capture attempts, retry, and delete.",
      },
      {
        name: "Review",
        description: "Approve or reject snapshots, bulk actions, re-diff, and review comments.",
      },
      { name: "Labels", description: "Typed build labels and their link templates." },
      {
        name: "Members",
        description: "Project members, roles, and identity-provider group mappings.",
      },
      { name: "Tokens", description: "API tokens used by the CLI and CI." },
      { name: "Webhooks", description: "Signed webhook deliveries for build events." },
      {
        name: "Notifications",
        description: "Email and chat notification channels and subscriptions.",
      },
      { name: "Git status", description: "Commit-status integrations for GitHub and GitLab." },
      { name: "Admin", description: "Site-wide administration." },
    ],
  });
  app.get("/api/v1/docs", swaggerUI({ url: "/api/v1/openapi.json" }));
}

/** Package version injected at build via __PKG_VERSION__. */
function packageVersion(): string {
  return (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0";
}

/**
 * Public surface: the app and its types only.
 *
 * `createShelfApp` plus the option/config types needed to call it. Adapter
 * interfaces live under `core/adapter/*`; runtime helpers under `core/logger`,
 * `core/capture`, `core/paths`, `core/urls`, `core/diff`; tables and row types
 * under `core/schema`. Importing the barrel must never pull Node-only modules
 * into edge bundles beyond what Hono itself needs.
 */
export { createAuthSystemHook } from "./notify.ts";
export type {
  ShelfOptions,
  ShelfConfig,
  UIConfig,
  BrandTheme,
  NotificationsConfig,
} from "@storyshelf/core/config";
export {
  createShelfLogger,
  type Logger,
  type LoggerOptions,
  type PinoTransport,
} from "@storyshelf/core/logger";
export type { ShelfApp, ShelfContext, ShelfLifecycle, ShelfRouter } from "./app-types.ts";
