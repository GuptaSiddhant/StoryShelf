// Must load first: tsyringe (via @peculiar/x509 in passkey auth) throws at import without it.
import "reflect-metadata";
import {
  createAuthSystemHook,
  defineShelfInstance,
  type ShelfInstanceContext,
} from "@storyshelf/app";
import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";
import { parseReadOnlyAccounts } from "@storyshelf/core/auth";
import {
  parseTrustProxy,
  readSetting,
  type ShelfConfig,
  type ShelfOptions,
} from "@storyshelf/core/config";
import {
  createEmailNotifier,
  gitFromEnv,
  integrationsFromEnv,
  smtpPresetFromEnv,
  vapidConfigFromEnv,
} from "@storyshelf/core/integrations";
import { createShelfLogger } from "@storyshelf/core/logger";
import { otelLogMixin } from "@storyshelf/observability";
import { initObservabilityFromEnv } from "@storyshelf/observability/node";
import { createCaptureRunner } from "@storyshelf/runner";
/**
 * The StoryShelf product image's instance (`docker run ghcr.io/guptasiddhant/storyshelf`): the module
 * `storyshelf-server serve` loads (`package.json#storyshelf.server`), never a constructed app.
 *
 * Everything comes from the environment: `DATABASE_URL`, or `SHELF_DATABASE_IAM_HOST` + `SHELF_DATABASE_IAM_USER` +
 * `SHELF_DATABASE_IAM_NAME` + `SHELF_DATABASE_IAM_REGION` for RDS IAM login (SQLite on `/data` when neither is set),
 * `SHELF_DATABASE_POOL_MAX`, `SHELF_DATABASE_CA` / `SHELF_DATABASE_CA_FILE`, `SHELF_S3_BUCKET`, `SHELF_GCS_BUCKET` or Azure Blob (`SHELF_AZURE_CONTAINER` is required, with either
 * `SHELF_AZURE_ACCOUNT` [+ `AZURE_CLIENT_ID`] or `SHELF_AZURE_CONNECTION_STRING`) for one object store (local storage on `/data` when none is set),
 * `SHELF_SECRET` (`SHELF_SECRET_PREVIOUS` and `SHELF_SECRET_MIGRATE` to rotate it), `SHELF_PUBLIC_BASE_URL`, `SHELF_ADMIN_PASSWORD`,
 * `SHELF_ADMIN_EMAIL`, `SHELF_SMTP_*`, `SHELF_VAPID_*` (web push, ADR 0048), the server's git connections (`SHELF_GITHUB_APP_ID` +
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
  isLoopback,
  nonEmpty,
  unverifiedDatabaseTls,
  storageFromEnv,
  storybookHostingFromEnv,
} from "./env.ts";

const hostname = "0.0.0.0";

type Env = Readonly<Record<string, string | undefined>>;
type Logger = ReturnType<typeof createShelfLogger>;

/** The database and the object store, opened (and logged) from `env`. */
function openAdapters(
  env: Env,
  dataDir: string,
  logger: Logger,
): Pick<ShelfOptions, "database" | "storage"> {
  mkdirSync(dataDir, { recursive: true });
  const { database, log: databaseLog } = databaseFromEnv(env, dataDir);
  const { storage, log: storageLog } = storageFromEnv(env, dataDir);
  logger.info({ ...databaseLog, ...storageLog }, "adapters");
  if (unverifiedDatabaseTls(env)) {
    logger.warn(
      { sslmode: "unverified" },
      "DATABASE_URL asks for TLS without checking the database certificate; set SHELF_DATABASE_CA (or SHELF_DATABASE_CA_FILE) and sslmode=verify-full",
    );
  }
  return { database, storage };
}

/** Git connections from the environment (ADR 0054, decision 9): the key and token are never logged. */
function openGit(env: Env, logger: Logger): ReturnType<typeof gitFromEnv> {
  // A half-set connection stops the server here, naming the variable and never its value.
  const git = gitFromEnv(env);
  logger.info(
    {
      gitConnections: (git.connections ?? []).map((connection) => connection.id),
      gitLinks: git.links?.length ?? 0,
    },
    "git connections",
  );
  return git;
}

interface AuthParts {
  env: Env;
  database: ShelfOptions["database"];
  emailSender: Awaited<ReturnType<typeof smtpPresetFromEnv>>;
  logger: Logger;
  baseURL: string;
}

/** Sign-in first: a short SHELF_SECRET throws here, before anything listens. */
function authOf({ env, database, emailSender, logger, baseURL }: AuthParts): ShelfOptions["auth"] {
  const imageAuth = authFromEnv(env);
  if (imageAuth.mode !== "password") return undefined;
  return createShelfAuth({
    db: database,
    secret: imageAuth.secret,
    baseURL,
    passkeys: {},
    emailSender,
    fromEmail: readSetting(env, "SHELF_SMTP_FROM"),
    onAuthSystemEvent: createAuthSystemHook(),
    logger,
    // Shared accounts that sign in and read but never write (#1274), comma-separated emails.
    readOnlyAccounts: parseReadOnlyAccounts(env["SHELF_READ_ONLY_ACCOUNTS"]),
  }).adapter;
}

function configOf(env: Env, dataDir: string): ShelfConfig {
  const storybookHosting = storybookHostingFromEnv(env);
  const trustProxy = parseTrustProxy(readSetting(env, "SHELF_TRUST_PROXY"));
  return {
    secret: nonEmpty(readSetting(env, "SHELF_SECRET")),
    // Rotation (guides/deployment/secret-rotation): the old key decrypts until credentials move.
    previousSecret: nonEmpty(readSetting(env, "SHELF_SECRET_PREVIOUS")),
    migrateCredentialsOnBoot: readSetting(env, "SHELF_SECRET_MIGRATE") === "true",
    adminToken: readSetting(env, "SHELF_ADMIN_TOKEN"),
    publicBaseUrl: nonEmpty(readSetting(env, "SHELF_PUBLIC_BASE_URL")),
    ...(storybookHosting === undefined ? {} : { storybookHosting }),
    ...(trustProxy === undefined ? {} : { trustProxy }),
    scratchDir: dataDir,
  };
}

/** With SHELF_SMTP_* set the built-in `email` notifier sends through that transport. */
function notificationsOf(
  env: Env,
  integrations: ReturnType<typeof integrationsFromEnv>,
  emailSender: AuthParts["emailSender"],
): ShelfOptions["notifications"] {
  // Web push (ADR 0048): off without SHELF_VAPID_PUBLIC_KEY and SHELF_VAPID_PRIVATE_KEY; the subject
  // (SHELF_VAPID_SUBJECT) is then required.
  const vapid = vapidConfigFromEnv(env);
  return {
    ...(vapid ? { vapid } : {}),
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
  };
}

/** The image's options: everything comes from `env` (the bin's `process.env`, `.env` already loaded). */
async function imageOptions(env: Env): Promise<ShelfOptions> {
  const dataDir = readSetting(env, "SHELF_DATA_DIR") ?? "/data";
  const config = configOf(env, dataDir);
  const observability = await initObservabilityFromEnv();
  const logger = createShelfLogger({ mixin: otelLogMixin });
  const { database, storage } = openAdapters(env, dataDir, logger);
  // Every built-in integration is registered (ADR 0049); SHELF_INTEGRATIONS_DISABLED turns some off (#1126).
  const emailSender = await smtpPresetFromEnv(env, logger);
  const integrations = integrationsFromEnv(env);
  const baseURL = config.publicBaseUrl ?? `http://localhost:${Number(env["PORT"] ?? 3000)}`;
  const auth = authOf({ env, database, emailSender, logger, baseURL });
  return {
    database,
    storage,
    ...(captureEnabled(env)
      ? { testing: { runner: createCaptureRunner({ browsers: browsersFromEnv(env) }) } }
      : {}),
    design: integrations.design,
    git: openGit(env, logger),
    notifications: notificationsOf(env, integrations, emailSender),
    ...(auth ? { auth } : {}),
    logger,
    observability,
    config,
  };
}

/** The migrated database exists: ensure the password admin, or warn about an open server. */
async function ensureAdmin({ options, env }: ShelfInstanceContext): Promise<void> {
  const imageAuth = authFromEnv(env);
  const logger = options.logger ?? createShelfLogger({ mixin: otelLogMixin });
  if (imageAuth.mode === "password") {
    await ensurePasswordAdmin(options.database, {
      email: imageAuth.email,
      password: imageAuth.password,
    });
    logger.info({ email: imageAuth.email }, "Local admin login enabled from SHELF_ADMIN_PASSWORD");
  } else if (!isLoopback(hostname)) {
    logger.warn({ hostname }, "SHELF_AUTH=none on a non-loopback address: every route is open");
  }
}

export default defineShelfInstance(imageOptions, { afterSetup: ensureAdmin });
