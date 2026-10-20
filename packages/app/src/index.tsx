import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import {
  AdapterLifecycleError,
  adapterSourcesOf,
  validateBootAssembly,
} from "@storyshelf/core/adapter/setup";
import { resolveShelfOptions } from "@storyshelf/core/config";
import type { ShelfConfig, ShelfOptions } from "@storyshelf/core/config";
import { configureImages } from "@storyshelf/core/diff";
/**
 * StoryShelf app: compose database, storage, capture, auth, and git-host
 * adapters into a complete self-hosted visual-testing Hono app.
 */
import {
  createHttpMiddleware,
  createInstrumentedDatabase,
  createInstrumentedStorage,
} from "@storyshelf/observability";
import { requestId } from "hono/request-id";
import type { ShelfApp, ShelfContext, ShelfRouter } from "./app-types.ts";
import { runBootTasks } from "./boot-tasks.ts";
import { setupCaptureQueue } from "./capture-setup.ts";
import { attachLifecycle, type LifecycleCell } from "./lifecycle.ts";
import {
  authGate,
  csrf,
  createRateLimiter,
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
import { registerBaselines } from "./routers/baselines.ts";
import { registerBuilds } from "./routers/builds.ts";
import { registerConnections } from "./routers/connections.ts";
import { registerHealth, type HealthDeps } from "./routers/health.ts";
import { registerInsightFragments } from "./routers/insights-ui.tsx";
import { registerInsights } from "./routers/insights.ts";
import { registerLabels } from "./routers/labels.ts";
import { registerLinks } from "./routers/links.ts";
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
  const invalid = validateBootAssembly(adapterSourcesOf(options));
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
  runBootTasks(cell, scoped, runtime, recoverStuck);
  wireMiddleware(app, {
    ...runtime,
    queue,
    enqueueCapture,
    options: scoped,
    getReady: async () => await cell.ready,
  });
  registerAllRoutes(app, options, {
    sources: adapterSourcesOf(options),
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
export function createShelfApp(rawOptions: ShelfOptions): ShelfApp {
  const options = resolveShelfOptions(rawOptions);
  configureImages({ engine: options.images?.engine, threads: options.compare?.threads });
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
  "/connections/*",
  "/profile",
  "/admin/credentials/*",
  "/projects/:slug/builds/:buildId/insights/generate",
  "/projects/:slug/insights/health/generate",
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
  mountStoreScope(app, wiring);
  app.use("*", authGate());
}

const MINUTE = 60_000;

/** Per-path limits; `bucket` gives a route family its own counter (default: shared `api:`). */
const RATE_LIMITS: readonly { paths: string[]; max: number; bucket?: string }[] = [
  { paths: ["/api/v1/*"], max: 100 },
  { paths: ["/api/v1/tokens/*"], max: 10 },
  { paths: ["/api/v1/webhooks/*"], max: 20 },
  // Auth endpoints ride their own buckets (the store keys by IP, so a prefix
  // keeps login floods from eating the API budget or vice versa).
  { paths: ["/auth/*"], max: 100, bucket: "auth" },
  { paths: ["/api/auth/*"], max: 300, bucket: "engine" },
  {
    paths: [
      "/api/v1/projects/:slug/notification-channels",
      "/api/v1/projects/:slug/notification-channels/:channelId",
    ],
    max: 20,
    bucket: "notify-channels",
  },
  {
    paths: ["/api/v1/projects/:slug/notifications", "/api/v1/projects/:slug/notifications/me"],
    max: 30,
    bucket: "notify-subs",
  },
  {
    paths: [
      "/api/v1/admin/notification-channels",
      "/api/v1/admin/notification-channels/:channelId",
    ],
    max: 20,
    bucket: "notify-admin",
  },
];

/** Mount rate limits and CSRF guards (abuse floors, not strict protection). */
function mountGuards(app: ShelfRouter, config: ShelfConfig): void {
  const rateLimit = createRateLimiter();
  for (const { paths, max, bucket } of RATE_LIMITS) {
    const keyGenerator = bucket ? rateLimitKey(bucket) : undefined;
    for (const path of paths) {
      app.use(path, rateLimit({ windowMs: MINUTE, max, keyGenerator }));
    }
  }
  for (const path of CSRF_PATHS) {
    app.use(path, csrf(config.secret));
  }
}

/** Mount the request-scoped store (db/storage/config/user/adapters). */
function mountStoreScope(app: ShelfRouter, wiring: MiddlewareWiring): void {
  const {
    options,
    config,
    ui,
    logger,
    authEnabled,
    enqueueCapture,
    queue,
    gitHosts,
    design,
    notifiers,
  } = wiring;
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
      captureConcurrency: options.capture?.concurrency,
      gitHosts,
      design,
      notifiers,
      notificationsConfig: options.notifications?.config,
      ai: options.ai,
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
  registerLinks(app);
  registerBaselines(app);
  registerMedia(app);
  registerMembers(app);
  registerTokens(app);
  registerWebhooks(app);
  registerInsights(app);
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
  registerConnections(app);
}

/** Register HTML pages, assets, and the optional auth flow. */
function registerPageRoutes(app: ShelfRouter, options: ShelfOptions, health: HealthDeps): void {
  registerAuthFlow(app, options);
  registerAssets(app);
  registerStorybook(app);
  registerAdminPages(app, health, options.auth);
  registerUiPages(app);
  registerInsightFragments(app);
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
        name: "Links",
        description:
          "Link packages to the projects that publish them and see where stories use them.",
      },
      { name: "Baselines", description: "Export and import baselines as a portable zip." },
      {
        name: "Members",
        description: "Project members, roles, and identity-provider group mappings.",
      },
      {
        name: "Insights",
        description: "AI build triage and project health (advisory only; needs AI configured).",
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

declare const __PKG_VERSION__: string | undefined;

/**
 * Package version injected at build via the `__PKG_VERSION__` define. Read as a bare identifier:
 * bundler defines replace identifiers, not `globalThis` property reads. Undefined when running
 * from source (dev server, tests).
 */
function packageVersion(): string {
  return typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0";
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
  ShelfCaptureOptions,
  ShelfCompareOptions,
  ShelfNotificationsOptions,
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
