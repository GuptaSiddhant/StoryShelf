// Must load first: tsyringe (via @peculiar/x509 in passkey auth) throws at import without it.
import "reflect-metadata";
import { serve } from "@hono/node-server";
import { createAuthSystemHook, createShelfApp } from "@storyshelf/app";
import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";
import { parseTrustProxy } from "@storyshelf/core/config";
import {
  createEmailNotifier,
  integrationsFromEnv,
  smtpPresetFromEnv,
} from "@storyshelf/core/integrations";
import { createShelfLogger } from "@storyshelf/core/logger";
import { otelLogMixin } from "@storyshelf/observability";
import { initObservabilityFromEnv } from "@storyshelf/observability/node";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";
/**
 * The StoryShelf product image's server (`docker run ghcr.io/guptasiddhant/storyshelf`).
 *
 * Everything comes from the environment: `DATABASE_URL`, or `DATABASE_IAM_HOST` + `DATABASE_IAM_USER` +
 * `DATABASE_IAM_NAME` + `DATABASE_IAM_REGION` for RDS IAM login (SQLite on `/data` when neither is set),
 * `DATABASE_POOL_MAX`, `DATABASE_CA` / `DATABASE_CA_FILE`, `AWS_BUCKET`, `GCS_BUCKET` or Azure Blob (`AZURE_STORAGE_CONTAINER` is required, with either
 * `AZURE_STORAGE_ACCOUNT` [+ `AZURE_CLIENT_ID`] or `AZURE_STORAGE_CONNECTION`) for one object store (local storage on `/data` when none is set),
 * `SECRET` (`SECRET_PREVIOUS` and `SECRET_MIGRATE` to rotate it), `PUBLIC_BASE_URL`, `AUTH_PASSWORD`,
 * `AUTH_EMAIL`, `SMTP_*`,
 * `SHUTDOWN_GRACE_SECONDS` (bound of the SIGTERM drain, a few seconds below the platform's stop timeout),
 * `PLAYWRIGHT_SERVICE_URL` + `PLAYWRIGHT_SERVICE_ACCESS_TOKEN` (an Azure Playwright Workspace, off
 * unless set), `SHELF_STORYBOOK_HOSTING` (`trusted` by default, or `sandboxed`; ADR 0051) and `SHELF_CAPTURE=off` (hosting only; the `-hosting` image sets it). Sign-in is on:
 * `AUTH_PASSWORD` and `SECRET` are required unless `SHELF_AUTH=none` opts out explicitly, and a
 * missing or short secret stops the server. Bundled by rolldown (`rolldown.config.ts`).
 */
import { mkdirSync } from "node:fs";
import {
  authFromEnv,
  browsersFromEnv,
  captureEnabled,
  databaseFromEnv,
  describeBootFailure,
  isLoopback,
  nonEmpty,
  unverifiedDatabaseTls,
  storageFromEnv,
  storybookHostingFromEnv,
} from "./env.ts";
import { exitBy, shutdownGraceMs } from "./shutdown.ts";

const env = process.env;

const dataDir = env["DATA_DIR"] ?? "/data";
const port = Number(env["PORT"] ?? 3000);
const hostname = "0.0.0.0";
const secret = nonEmpty(env["SECRET"]);
const publicBaseUrl = nonEmpty(env["PUBLIC_BASE_URL"]);
// Bound of the SIGTERM drain: jobs still running then are handed back for another machine (#912).
const graceMs = shutdownGraceMs(env);
const trustProxy = parseTrustProxy(env["TRUST_PROXY"]);

// Every refusal below throws before the server listens. Node would print the throwing source line
// first, so the reason (naming the variable, never its value) is printed as the first line instead.
process.on("uncaughtException", (error) => {
  process.stderr.write(describeBootFailure(error));
  process.exit(1);
});
const imageAuth = authFromEnv(env);
const storybookHosting = storybookHostingFromEnv(env);

mkdirSync(dataDir, { recursive: true });
const { database, log: databaseLog } = databaseFromEnv(env, dataDir);
const { storage, log: storageLog } = storageFromEnv(env, dataDir);
const observability = await initObservabilityFromEnv();
const shelfLogger = createShelfLogger({ mixin: otelLogMixin });
shelfLogger.info({ ...databaseLog, ...storageLog }, "adapters");
if (unverifiedDatabaseTls(env)) {
  shelfLogger.warn(
    { sslmode: "unverified" },
    "DATABASE_URL asks for TLS without checking the database certificate; set DATABASE_CA (or DATABASE_CA_FILE) and sslmode=verify-full",
  );
}

// Every built-in integration is registered (ADR 0049); with SMTP_* set the `email` notifier sends through it.
const emailSender = await smtpPresetFromEnv(env, shelfLogger);
// SHELF_INTEGRATIONS_DISABLED turns integrations off without code (#1126); an unknown kind stops startup.
const integrations = integrationsFromEnv(env);
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
  design: integrations.design,
  notifications: {
    notifiers: (builtIn) =>
      integrations.notifiers(
        emailSender
          ? builtIn.map((provider) =>
              provider.metadata.kind === "email"
                ? createEmailNotifier(emailSender, { from: env["SMTP_FROM"] })
                : provider,
            )
          : builtIn,
      ),
  },
  ...(auth ? { auth } : {}),
  logger: shelfLogger,
  observability,
  config: {
    secret,
    // Rotation (guides/deployment/secret-rotation): the old key decrypts until credentials move.
    previousSecret: nonEmpty(env["SECRET_PREVIOUS"]),
    migrateCredentialsOnBoot: env["SECRET_MIGRATE"] === "true",
    adminToken: env["STORYSHELF_ADMIN_TOKEN"] ?? env["ADMIN_TOKEN"],
    publicBaseUrl,
    ...(storybookHosting === undefined ? {} : { storybookHosting }),
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
    // A bounded drain may leave a stuck handler to its lease: the process must end it, whatever
    // the rest of the teardown does, so the exit is armed now, not after it.
    if (graceMs !== undefined) exitBy(graceMs);
    app.lifecycle
      .teardown(graceMs === undefined ? {} : { graceMs })
      .catch(() => {}) // Intentionally empty — teardown errors are already logged
      .finally(() => {
        server.close();
      });
  });
}
