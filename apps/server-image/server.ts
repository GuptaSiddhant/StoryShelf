// Must load first: tsyringe (via @peculiar/x509 in passkey auth) throws at import without it.
import "reflect-metadata";
import { serve } from "@hono/node-server";
import { createAuthSystemHook, createShelfApp } from "@storyshelf/app";
import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";
import { parseReadOnlyAccounts } from "@storyshelf/core/auth";
import {
  OLD_NAMES_ALLOWED_MESSAGE,
  oldNamesAllowedFields,
  parseTrustProxy,
  readSetting,
  refuseRenamedSettings,
} from "@storyshelf/core/config";
import {
  createEmailNotifier,
  gitFromEnv,
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
 * Everything comes from the environment: `DATABASE_URL`, or `SHELF_DATABASE_IAM_HOST` + `SHELF_DATABASE_IAM_USER` +
 * `SHELF_DATABASE_IAM_NAME` + `SHELF_DATABASE_IAM_REGION` for RDS IAM login (SQLite on `/data` when neither is set),
 * `SHELF_DATABASE_POOL_MAX`, `SHELF_DATABASE_CA` / `SHELF_DATABASE_CA_FILE`, `SHELF_S3_BUCKET`, `SHELF_GCS_BUCKET` or Azure Blob (`SHELF_AZURE_CONTAINER` is required, with either
 * `SHELF_AZURE_ACCOUNT` [+ `AZURE_CLIENT_ID`] or `SHELF_AZURE_CONNECTION_STRING`) for one object store (local storage on `/data` when none is set),
 * `SHELF_SECRET` (`SHELF_SECRET_PREVIOUS` and `SHELF_SECRET_MIGRATE` to rotate it), `SHELF_PUBLIC_BASE_URL`, `SHELF_ADMIN_PASSWORD`,
 * `SHELF_ADMIN_EMAIL`, `SHELF_SMTP_*`, the server's git connections (`SHELF_GITHUB_APP_ID` +
 * `SHELF_GITHUB_APP_PRIVATE_KEY[_FILE]`, `SHELF_GITHUB_API_URL`, `SHELF_GITLAB_HOST`,
 * `SHELF_GITLAB_TOKEN[_FILE]` + `SHELF_GITLAB_TOKEN_EXPIRES`, `SHELF_GIT_CONFIG_FILE`; ADR 0054),
 * `SHELF_SHUTDOWN_GRACE_SECONDS` (bound of the SIGTERM drain, a few seconds below the platform's stop timeout),
 * `PLAYWRIGHT_SERVICE_URL` + `PLAYWRIGHT_SERVICE_ACCESS_TOKEN` (an Azure Playwright Workspace, off
 * unless set), `SHELF_STORYBOOK_HOSTING` (`trusted` by default, or `sandboxed`; ADR 0051) and `SHELF_CAPTURE=off` (hosting only; the `-hosting` image sets it). Sign-in is on:
 * `SHELF_ADMIN_PASSWORD` and `SHELF_SECRET` are required unless `SHELF_AUTH=none` opts out explicitly, and a
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

// Every refusal below throws before the server listens. Node would print the throwing source line
// and a bundle stack, so a refusal prints only its reason (naming the variable, never its value);
// any other error still prints its stack.
process.on("uncaughtException", (error) => {
  process.stderr.write(describeBootFailure(error));
  process.exit(1);
});
// The variables were renamed with no aliases (#1308, owner policy #1309): boot refuses while an
// old name is set, listing each with its new name and never a value, so no setting is silently dropped.
// With SHELF_ALLOW_OLD_NAMES=1 the old names found come back, to be logged once below.
const ignoredOldNames = refuseRenamedSettings(env);

const dataDir = readSetting(env, "SHELF_DATA_DIR") ?? "/data";
const port = Number(env["PORT"] ?? 3000);
const hostname = "0.0.0.0";
const secret = nonEmpty(readSetting(env, "SHELF_SECRET"));
const publicBaseUrl = nonEmpty(readSetting(env, "SHELF_PUBLIC_BASE_URL"));
// Bound of the SIGTERM drain: jobs still running then are handed back for another machine (#912).
const graceMs = shutdownGraceMs(env);
const trustProxy = parseTrustProxy(readSetting(env, "SHELF_TRUST_PROXY"));

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
    "DATABASE_URL asks for TLS without checking the database certificate; set SHELF_DATABASE_CA (or SHELF_DATABASE_CA_FILE) and sslmode=verify-full",
  );
}

// Every built-in integration is registered (ADR 0049); with SHELF_SMTP_* set the `email` notifier sends through it.
const emailSender = await smtpPresetFromEnv(env, shelfLogger);
// SHELF_INTEGRATIONS_DISABLED turns integrations off without code (#1126); an unknown kind stops startup.
const integrations = integrationsFromEnv(env);
// Git connections from the environment (ADR 0054, decision 9): a half-set one stops the server here,
// naming the variable and never its value. The key and the token are read once and never logged.
const git = gitFromEnv(env);
shelfLogger.info(
  {
    gitConnections: (git.connections ?? []).map((connection) => connection.id),
    gitLinks: git.links?.length ?? 0,
  },
  "git connections",
);
const testing = captureEnabled(env)
  ? { runner: createPlaywrightCaptureRunner({ browsers: browsersFromEnv(env) }) }
  : undefined;

// Sign-in first: a short SHELF_SECRET throws here, before anything listens.
const auth =
  imageAuth.mode === "password"
    ? createShelfAuth({
        db: database,
        secret: imageAuth.secret,
        baseURL: publicBaseUrl ?? `http://localhost:${port}`,
        passkeys: {},
        emailSender,
        fromEmail: readSetting(env, "SHELF_SMTP_FROM"),
        onAuthSystemEvent: createAuthSystemHook(),
        logger: shelfLogger,
        // Shared accounts that sign in and read but never write (#1274), comma-separated emails.
        readOnlyAccounts: parseReadOnlyAccounts(env["SHELF_READ_ONLY_ACCOUNTS"]),
      }).adapter
    : undefined;

const app = createShelfApp({
  database,
  storage,
  ...(testing ? { testing } : {}),
  design: integrations.design,
  git,
  notifications: {
    notifiers: (builtIn) =>
      integrations.notifiers(
        emailSender
          ? builtIn.map((provider) =>
              provider.metadata.kind === "email"
                ? createEmailNotifier(emailSender, { from: readSetting(env, "SHELF_SMTP_FROM") })
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
    previousSecret: nonEmpty(readSetting(env, "SHELF_SECRET_PREVIOUS")),
    migrateCredentialsOnBoot: readSetting(env, "SHELF_SECRET_MIGRATE") === "true",
    adminToken: readSetting(env, "SHELF_ADMIN_TOKEN"),
    publicBaseUrl,
    ...(storybookHosting === undefined ? {} : { storybookHosting }),
    ...(trustProxy === undefined ? {} : { trustProxy }),
    scratchDir: dataDir,
  },
});

// A failed boot check (auth secret, AI, images, adapters) stops the server: it never listens.
await app.lifecycle.setup();
const logger = app.lifecycle.logger;
if (ignoredOldNames.length > 0) {
  logger.warn(oldNamesAllowedFields(ignoredOldNames), OLD_NAMES_ALLOWED_MESSAGE);
}

if (imageAuth.mode === "password") {
  await ensurePasswordAdmin(database, { email: imageAuth.email, password: imageAuth.password });
  logger.info({ email: imageAuth.email }, "Local admin login enabled from SHELF_ADMIN_PASSWORD");
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
