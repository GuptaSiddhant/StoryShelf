// Must load first: tsyringe (via @peculiar/x509 in passkey auth) throws at import without it.
import "reflect-metadata";
import { serve } from "@hono/node-server";
import { createAuthSystemHook, createShelfApp } from "@storyshelf/app";
import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";
import { parseTrustProxy } from "@storyshelf/core/config";
import { createShelfLogger } from "@storyshelf/core/logger";
import { chatNotifiers } from "@storyshelf/notify-chat";
import { createEmailNotifier, smtpPresetFromEnv } from "@storyshelf/notify-email";
import { otelLogMixin } from "@storyshelf/observability";
import { initObservabilityFromEnv } from "@storyshelf/observability/node";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";
/**
 * The StoryShelf product image's server (`docker run ghcr.io/guptasiddhant/storyshelf`).
 *
 * Everything comes from the environment: `DATABASE_URL`, or `DATABASE_IAM_HOST` + `DATABASE_IAM_USER` +
 * `DATABASE_IAM_NAME` + `DATABASE_IAM_REGION` for RDS IAM login (SQLite on `/data` when neither is set),
 * `DATABASE_POOL_MAX`, `AWS_BUCKET`
 * (local storage on `/data` when unset), `SECRET`, `PUBLIC_BASE_URL`, `AUTH_PASSWORD`, `SMTP_*`,
 * `PLAYWRIGHT_SERVICE_URL` + `PLAYWRIGHT_SERVICE_ACCESS_TOKEN` (an Azure Playwright Workspace, off
 * unless set) and `SHELF_CAPTURE=off` (hosting only; the `-hosting` image sets it). Bundled by
 * rolldown (`rolldown.config.ts`).
 */
import { mkdirSync } from "node:fs";
import {
  browsersFromEnv,
  captureEnabled,
  databaseFromEnv,
  nonEmpty,
  storageFromEnv,
} from "./env.ts";

const env = process.env;
const dataDir = env["DATA_DIR"] ?? "/data";
const port = Number(env["PORT"] ?? 3000);
const secret = nonEmpty(env["SECRET"]);
const authPassword = nonEmpty(env["AUTH_PASSWORD"]);
const authEmail = env["AUTH_EMAIL"] ?? "admin@example.com";
const publicBaseUrl = nonEmpty(env["PUBLIC_BASE_URL"]);
const trustProxy = parseTrustProxy(env["TRUST_PROXY"]);

mkdirSync(dataDir, { recursive: true });
const { database, log: databaseLog } = databaseFromEnv(env, dataDir);
const { storage, log: storageLog } = storageFromEnv(env, dataDir);
const observability = await initObservabilityFromEnv();
const shelfLogger = createShelfLogger({ mixin: otelLogMixin });
shelfLogger.info({ ...databaseLog, ...storageLog }, "adapters");

const emailSender = smtpPresetFromEnv(env, shelfLogger);
const testing = captureEnabled(env)
  ? { runner: createPlaywrightCaptureRunner({ browsers: browsersFromEnv(env) }) }
  : undefined;

const app = createShelfApp({
  database,
  storage,
  ...(testing ? { testing } : {}),
  notifications: {
    notifiers: [
      ...chatNotifiers,
      ...(emailSender ? [createEmailNotifier(emailSender, { from: env["SMTP_FROM"] })] : []),
    ],
  },
  auth:
    authPassword && secret
      ? createShelfAuth({
          db: database,
          secret,
          baseURL: publicBaseUrl ?? `http://localhost:${port}`,
          passkeys: {},
          emailSender,
          fromEmail: env["SMTP_FROM"],
          onAuthSystemEvent: createAuthSystemHook(),
          logger: shelfLogger,
        }).adapter
      : undefined,
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

await app.lifecycle.setup();
const logger = app.lifecycle.logger;

if (authPassword && secret) {
  await ensurePasswordAdmin(database, { email: authEmail, password: authPassword });
  logger.info({ email: authEmail }, "Local admin login enabled from AUTH_PASSWORD");
}

const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
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
