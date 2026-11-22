// Must load first: tsyringe (via @peculiar/x509 in passkey auth) throws at import without it, and the
// bundler does not preserve the transitive side-effect import.
import "reflect-metadata";
import {
  createAuthSystemHook,
  defineShelfInstance,
  type ShelfInstanceContext,
} from "@storyshelf/app";
import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";
import { parseReadOnlyAccounts } from "@storyshelf/core/auth";
import type { AuthUiConfig, ShelfConfig, ShelfOptions, UIConfig } from "@storyshelf/core/config";
import { parseTrustProxy, readSetting } from "@storyshelf/core/config";
import {
  createEmailNotifier,
  gitFromEnv,
  integrationsFromEnv,
  smtpPresetFromEnv,
} from "@storyshelf/core/integrations";
import { createShelfLogger } from "@storyshelf/core/logger";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { otelLogMixin } from "@storyshelf/observability";
import { initObservabilityFromEnv } from "@storyshelf/observability/node";
import { createCaptureRunner } from "@storyshelf/runner";
/**
 * Fly demo instance (the module `storyshelf-server serve` loads, `package.json#storyshelf.server`) — SQLite on the volume, objects on the volume or in S3-compatible storage.
 *
 * Bundled by rolldown from workspace sources (`rolldown.config.ts`), so it
 * deploys whatever is on `main` with no publish step. `nub run dev` runs this
 * file from source instead.
 *
 * Mirrors apps/dev-server/src/server.ts wiring:
 *  - @storyshelf/db-sqlite → {SHELF_DATA_DIR}/shelf.db
 *  - @storyshelf/core/storage/local → SHELF_DATA_DIR, or @storyshelf/storage/s3 (Tigris) when SHELF_S3_BUCKET is set
 *  - @storyshelf/runner → chrome-headless-shell installed in the image
 *
 * Capture stays in-process: the 1-CPU Fly VM is below the threshold where
 * core would fork a capture child, so a `testing.workerEntry` would never apply.
 */
import { mkdirSync } from "node:fs";
import { aiFromEnv, aiLogFields } from "./ai.ts";
import { databaseDeps } from "./demo-viewer-db.ts";
import { ensureDemoViewer } from "./demo-viewer.ts";
import { refuseLegacyVariables } from "./legacy-env.ts";
import { browsersFor, spriteFromEnv } from "./sprite.ts";
import { storageFromEnv } from "./storage.ts";

type Env = Readonly<Record<string, string | undefined>>;

function buildAuthUi(env: Env): AuthUiConfig | undefined {
  const pairs: Array<[string, string | undefined]> = [
    ["title", env["SHELF_AUTH_TITLE"]],
    ["subtitle", env["SHELF_AUTH_SUBTITLE"]],
    ["passwordLabel", env["SHELF_AUTH_PASSWORD_LABEL"]],
    ["passwordPlaceholder", env["SHELF_AUTH_PASSWORD_PLACEHOLDER"]],
    ["submitLabel", env["SHELF_AUTH_SUBMIT_LABEL"]],
    ["ssoLabelTemplate", env["SHELF_AUTH_SSO_LABEL"]],
    ["helpText", env["SHELF_AUTH_HELP_TEXT"]],
    ["footerText", env["SHELF_AUTH_FOOTER_TEXT"]],
  ];
  const out: AuthUiConfig = {};
  for (const [key, value] of pairs) {
    if (value) {
      Object.assign(out, { [key]: value });
    }
  }
  const href = env["SHELF_AUTH_PUBLIC_LINK_URL"];
  if (href) {
    out.publicLink = {
      href,
      label: env["SHELF_AUTH_PUBLIC_LINK_LABEL"] ?? "Browse without an account",
    };
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

function buildUi(env: Env): UIConfig | undefined {
  const name = env["SHELF_BRAND_NAME"];
  const logo = env["SHELF_LOGO_URL"];
  const auth = buildAuthUi(env);
  const hasBrand = Boolean(name ?? logo);
  if (!hasBrand && !auth) {
    return undefined;
  }
  return {
    ...(name ? { name } : {}),
    ...(logo ? { logo } : {}),
    ...(auth ? { auth } : {}),
  };
}

// Scheduled build purge is opt-in (ADR 0039): `SHELF_PURGE_TTL_DAYS` turns it on; unset leaves it off, so
// an upgrade never starts deleting builds. A value that is not a positive whole number stops the boot.
function purgeTtlDaysFromEnv(env: Env): number | undefined {
  const raw = readSetting(env, "SHELF_PURGE_TTL_DAYS");
  if (raw === undefined || raw === "") return undefined;
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new Error("SHELF_PURGE_TTL_DAYS must be a positive whole number of days");
  }
  return Number(raw);
}

// Rate limits key on the client, not Fly's proxy (#911): on Fly (`FLY_APP_NAME` is set by the
// platform) trust `Fly-Client-IP` unless `SHELF_TRUST_PROXY` says otherwise; `SHELF_TRUST_PROXY=false` opts out.
function trustProxyFromEnv(env: Env): ReturnType<typeof parseTrustProxy> {
  return readSetting(env, "SHELF_TRUST_PROXY") === undefined && env["FLY_APP_NAME"]
    ? "fly"
    : parseTrustProxy(readSetting(env, "SHELF_TRUST_PROXY"));
}

// The demo's one read-only account (#1275). The password is the Fly secret; it is never logged.
// Retried each minute because `storyshelf-ui` is created by the first upload, which can come
// after this boot; every run is idempotent and cheap.
async function provisionDemoViewer(
  options: ShelfOptions,
  env: Env,
  logger: ReturnType<typeof createShelfLogger>,
): Promise<void> {
  try {
    const done = await ensureDemoViewer(
      databaseDeps(options.database),
      env["SHELF_DEMO_VIEWER_PASSWORD"],
    );
    if (done.userCreated || done.memberAdded || done.credentialSet || done.roleFixed)
      logger.info(done, "Demo viewer provisioned");
  } catch (error) {
    logger.error({ err: error }, "Demo viewer provisioning failed");
  }
}

/** Boot hooks, once the database is migrated and before the port opens: the admin, then the demo viewer. */
async function bootHooks({ options, env }: ShelfInstanceContext): Promise<void> {
  const logger = options.logger ?? createShelfLogger({ mixin: otelLogMixin });
  const authPassword = readSetting(env, "SHELF_ADMIN_PASSWORD");
  if (!authPassword) return;
  const authEmail = readSetting(env, "SHELF_ADMIN_EMAIL") ?? "admin@example.com";
  await ensurePasswordAdmin(options.database, { email: authEmail, password: authPassword });
  logger.info({ email: authEmail }, "Local admin login enabled from SHELF_ADMIN_PASSWORD");
  if (env["SHELF_DEMO_VIEWER_PASSWORD"]) {
    await provisionDemoViewer(options, env, logger);
    setInterval(() => {
      provisionDemoViewer(options, env, logger).catch(() => {}); // Intentionally empty — it logs its own errors
    }, 60_000).unref();
  }
}

type Logger = ReturnType<typeof createShelfLogger>;

/** The volume's database, the object store, the capture runner and AI, each logged without secrets. */
function openParts(
  env: Env,
  dataDir: string,
  logger: Logger,
): Pick<ShelfOptions, "database" | "storage" | "testing" | "ai"> {
  mkdirSync(dataDir, { recursive: true });
  const database = createSqliteDatabase(`${dataDir}/shelf.db`);
  const { storage, log: storageLog } = storageFromEnv(env, dataDir);
  // With FLY_SPRITES_TOKEN and SPRITE_BROWSER_SECRET set, `chromium@sprite` (a hibernating Fly Sprite,
  // apps/fly-app/sprite/) is selectable beside the VM's own Chromium; unset, only the latter.
  const sprite = spriteFromEnv(env);
  // AI insights (ADR 0016) only with ANTHROPIC_API_KEY set: text only, Haiku, a small daily budget.
  // Unset, no `ai` is passed and the app answers `501 ai-disabled` with no AI UI, as before.
  const ai = aiFromEnv(env);
  // Which storage serves the objects: the origin of the endpoint only, never the bucket or a key.
  logger.info(storageLog, "object storage");
  // Only whether the Sprite is configured: its token, secret and URL never reach a log.
  logger.info({ spriteBrowser: sprite !== null }, "remote browsers");
  // Only the model in use (null while AI is off): the Anthropic key never reaches a log.
  logger.info(aiLogFields(ai), "ai insights");
  return {
    database,
    storage,
    // The runner reads SHELF_CAPTURE_CONCURRENCY itself; unset, it sizes from the VM's CPU and memory.
    testing: { runner: createCaptureRunner({ browsers: browsersFor(sprite) }) },
    ai,
  };
}

/** SHELF_ADMIN_PASSWORD without a valid SHELF_SECRET refuses to start (createShelfAuth throws); never auth off. */
function authOf(
  env: Env,
  database: ShelfOptions["database"],
  emailSender: Awaited<ReturnType<typeof smtpPresetFromEnv>>,
  logger: Logger,
): ShelfOptions["auth"] {
  if (!readSetting(env, "SHELF_ADMIN_PASSWORD")) return undefined;
  const port = Number(env["PORT"] ?? 3000);
  return createShelfAuth({
    db: database,
    secret: readSetting(env, "SHELF_SECRET") ?? "",
    baseURL: readSetting(env, "SHELF_PUBLIC_BASE_URL") ?? `http://localhost:${port}`,
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
  const trustProxy = trustProxyFromEnv(env);
  const purgeTtlDays = purgeTtlDaysFromEnv(env);
  const previousSecret = readSetting(env, "SHELF_SECRET_PREVIOUS");
  return {
    secret: readSetting(env, "SHELF_SECRET"),
    // Rotation: keep the old SHELF_SECRET here until stored credentials are re-encrypted.
    previousSecret: previousSecret === "" ? undefined : previousSecret,
    migrateCredentialsOnBoot: readSetting(env, "SHELF_SECRET_MIGRATE") === "true",
    adminToken: readSetting(env, "SHELF_ADMIN_TOKEN"),
    publicBaseUrl: readSetting(env, "SHELF_PUBLIC_BASE_URL"),
    ...(trustProxy === undefined ? {} : { trustProxy }),
    scratchDir: dataDir,
    ...(purgeTtlDays === undefined ? {} : { purgeTtlDays }),
    // Emit Server-Timing response headers (total + db/storage roll-ups).
    serverTiming: true,
  };
}

/**
 * Every built-in integration is registered (ADR 0049) and idle until a project configures it. With
 * SHELF_SMTP_* set, the built-in `email` notifier is swapped for one that sends through that transport
 * (undefined keeps invites out-of-band).
 */
function notificationsOf(
  env: Env,
  integrations: ReturnType<typeof integrationsFromEnv>,
  emailSender: Awaited<ReturnType<typeof smtpPresetFromEnv>>,
): ShelfOptions["notifications"] {
  const smtpFrom = readSetting(env, "SHELF_SMTP_FROM");
  return {
    notifiers: (builtIn) =>
      integrations.notifiers(
        emailSender
          ? builtIn.map((provider) =>
              provider.metadata.kind === "email"
                ? createEmailNotifier(emailSender, { from: smtpFrom })
                : provider,
            )
          : builtIn,
      ),
    ...(smtpFrom ? { config: { fromEmail: smtpFrom } } : {}),
  };
}

/**
 * Git connections from the environment (ADR 0054, decision 9), so the demo's App can move to a
 * configured connection. Unset, there are none and the demo's deployed secrets are untouched.
 */
function openGit(env: Env, logger: Logger): ReturnType<typeof gitFromEnv> {
  const git = gitFromEnv(env);
  logger.info({ gitConnections: (git.connections ?? []).map((c) => c.id) }, "git connections");
  return git;
}

/** The demo's options: everything comes from `env` (the bin's `process.env`, `.env` already loaded). */
async function demoOptions(env: Env): Promise<ShelfOptions> {
  refuseLegacyVariables(env);
  const dataDir = readSetting(env, "SHELF_DATA_DIR") ?? "/data";
  const config = configOf(env, dataDir);
  // Observability first (noop unless OTEL_EXPORTER_OTLP_ENDPOINT is set).
  const observability = await initObservabilityFromEnv();
  const logger = createShelfLogger({ mixin: otelLogMixin });
  const parts = openParts(env, dataDir, logger);
  const emailSender = await smtpPresetFromEnv(env, logger);
  // SHELF_INTEGRATIONS_DISABLED turns integrations off without code (#1126); an unknown kind stops startup.
  const integrations = integrationsFromEnv(env);
  return {
    ...parts,
    git: openGit(env, logger),
    design: integrations.design,
    notifications: notificationsOf(env, integrations, emailSender),
    auth: authOf(env, parts.database, emailSender, logger),
    ui: buildUi(env),
    logger,
    observability,
    config,
  };
}

export default defineShelfInstance(demoOptions, { afterSetup: bootHooks });
