// Must load first: tsyringe (via @peculiar/x509 in passkey auth) throws at import without it.
import "reflect-metadata";
import { serve } from "@hono/node-server";
import { createAuthSystemHook, createShelfApp } from "@storyshelf/app";
import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";
import { parseTrustProxy } from "@storyshelf/core/config";
import { createEmailNotifier, smtpPresetFromEnv } from "@storyshelf/core/integrations";
import { createShelfLogger } from "@storyshelf/core/logger";
import { otelLogMixin } from "@storyshelf/observability";
import { initObservabilityFromEnv } from "@storyshelf/observability/node";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";
/**
 * The StoryShelf product image's server (`docker run ghcr.io/guptasiddhant/storyshelf`).
 *
 * Everything comes from the environment: `DATABASE_URL` (SQLite on `/data` when unset), `AWS_BUCKET`
 * (local storage on `/data` when unset), `SECRET`, `PUBLIC_BASE_URL`, `AUTH_PASSWORD`, `SMTP_*`,
 * `PLAYWRIGHT_SERVICE_URL` + `PLAYWRIGHT_SERVICE_ACCESS_TOKEN` (an Azure Playwright Workspace, off
 * unless set) and `SHELF_CAPTURE=off` (hosting only; the `-hosting` image sets it). Sign-in is on:
 * `AUTH_PASSWORD` and `SECRET` are required unless `SHELF_AUTH=none` opts out explicitly, and a
 * missing or short secret stops the server. Bundled by rolldown (`rolldown.config.ts`).
 */
import { mkdirSync } from "node:fs";
import {
  authFromEnv,
  browsersFromEnv,
  captureEnabled,
  databaseFromEnv,
  isLoopback,
  nonEmpty,
  storageFromEnv,
} from "./env.ts";

const env = process.env;
const dataDir = env["DATA_DIR"] ?? "/data";
const port = Number(env["PORT"] ?? 3000);
const hostname = "0.0.0.0";
const secret = nonEmpty(env["SECRET"]);
const publicBaseUrl = nonEmpty(env["PUBLIC_BASE_URL"]);
const trustProxy = parseTrustProxy(env["TRUST_PROXY"]);

// Every refusal below throws before the server listens: Node exits non-zero with the message
// (naming the variable, never its value) as the first line.
const imageAuth = authFromEnv(env);

mkdirSync(dataDir, { recursive: true });
const { database, log: databaseLog } = databaseFromEnv(env, dataDir);
const { storage, log: storageLog } = storageFromEnv(env, dataDir);
const observability = await initObservabilityFromEnv();
const shelfLogger = createShelfLogger({ mixin: otelLogMixin });
shelfLogger.info({ ...databaseLog, ...storageLog }, "adapters");

// Every built-in integration is registered (ADR 0049); with SMTP_* set the `email` notifier sends through it.
const emailSender = await smtpPresetFromEnv(env, shelfLogger);
const testing = captureEnabled(env)
  ? { runner: createPlaywrightCaptureRunner({ browsers: browsersFromEnv(env) }) }
  : undefined;

// Sign-in first: a short SECRET throws here, before anything listens.
const auth =
  imageAuth.mode === "password"
    ? createShelfAuth({
        db: database,
        secret: imageAuth.secret,
        baseURL: publicBaseUrl ?? `http://localhost:${port}`,
        passkeys: {},
        emailSender,
        fromEmail: env["SMTP_FROM"],
        onAuthSystemEvent: createAuthSystemHook(),
        logger: shelfLogger,
      }).adapter
    : undefined;

const app = createShelfApp({
  database,
  storage,
  ...(testing ? { testing } : {}),
  notifications: {
    notifiers: (builtIn) =>
      emailSender
        ? builtIn.map((provider) =>
            provider.metadata.kind === "email"
              ? createEmailNotifier(emailSender, { from: env["SMTP_FROM"] })
              : provider,
          )
        : builtIn,
  },
  ...(auth ? { auth } : {}),
  logger: shelfLogger,
  observability,
  config: {
    secret,
    adminToken: env["STORYSHELF_ADMIN_TOKEN"] ?? env["ADMIN_TOKEN"],
    publicBaseUrl,
    ...(trustProxy === undefined ? {} : { trustProxy }),
    scratchDir: dataDir,
  },
});

// A failed boot check (auth secret, AI, images, adapters) stops the server: it never listens.
await app.lifecycle.setup();
const logger = app.lifecycle.logger;

if (imageAuth.mode === "password") {
  await ensurePasswordAdmin(database, { email: imageAuth.email, password: imageAuth.password });
  logger.info({ email: imageAuth.email }, "Local admin login enabled from AUTH_PASSWORD");
} else if (!isLoopback(hostname)) {
  logger.warn({ hostname }, "SHELF_AUTH=none on a non-loopback address: every route is open");
}

const server = serve({ fetch: app.fetch, port, hostname }, () => {
  logger.info({ port, dataDir, capture: testing !== undefined }, "StoryShelf listening");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.lifecycle
      .teardown()
      .catch(() => {}) // Intentionally empty — teardown errors are already logged
      .finally(() => {
        server.close();
      });
  });
}
