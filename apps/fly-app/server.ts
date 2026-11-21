// Must load first: tsyringe (via @peculiar/x509 in passkey auth) throws at import without it, and the
// bundler does not preserve the transitive side-effect import.
import "reflect-metadata";
import { createAuthSystemHook, createShelfApp } from "@storyshelf/app";
import { startServer } from "@storyshelf/app/node";
import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";
import { parseReadOnlyAccounts } from "@storyshelf/core/auth";
import type { AuthUiConfig, UIConfig } from "@storyshelf/core/config";
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
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { otelLogMixin } from "@storyshelf/observability";
import { initObservabilityFromEnv } from "@storyshelf/observability/node";
import { createCaptureRunner } from "@storyshelf/runner";
/**
 * Fly demo server — SQLite on the volume, objects on the volume or in S3-compatible storage.
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
import { shutdownGraceMs } from "./shutdown.ts";
import { browsersFor, spriteFromEnv } from "./sprite.ts";
import { storageFromEnv } from "./storage.ts";

const env = process.env;
refuseLegacyVariables(env);
// The variables were renamed with no aliases (#1308, owner policy #1309): boot refuses while an
// old name is set, listing each with its new name and never a value, so no setting is silently dropped.
// With SHELF_ALLOW_OLD_NAMES=1 the old names found come back, to be logged once below.
const ignoredOldNames = refuseRenamedSettings(env);
const smtpFrom = readSetting(env, "SHELF_SMTP_FROM");
const previousSecret = readSetting(env, "SHELF_SECRET_PREVIOUS");
const dataDir = readSetting(env, "SHELF_DATA_DIR") ?? "/data";
const port = Number(env["PORT"] ?? 3000);
const secret = readSetting(env, "SHELF_SECRET");
const authPassword = readSetting(env, "SHELF_ADMIN_PASSWORD");
const authEmail = readSetting(env, "SHELF_ADMIN_EMAIL") ?? "admin@example.com";
const adminToken = readSetting(env, "SHELF_ADMIN_TOKEN");
const publicBaseUrl = readSetting(env, "SHELF_PUBLIC_BASE_URL");
// Bound of the whole SIGTERM shutdown: jobs still running near it are handed back for another machine (#912).
const graceMs = shutdownGraceMs(env);
// Rate limits key on the client, not Fly's proxy (#911): on Fly (`FLY_APP_NAME` is set by the
// platform) trust `Fly-Client-IP` unless `SHELF_TRUST_PROXY` says otherwise; `SHELF_TRUST_PROXY=false` opts out.
const trustProxy =
  readSetting(env, "SHELF_TRUST_PROXY") === undefined && env["FLY_APP_NAME"]
    ? "fly"
    : parseTrustProxy(readSetting(env, "SHELF_TRUST_PROXY"));

function buildAuthUi(): AuthUiConfig | undefined {
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

function buildUi(): UIConfig | undefined {
  const name = env["SHELF_BRAND_NAME"];
  const logo = env["SHELF_LOGO_URL"];
  const auth = buildAuthUi();
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
const ui = buildUi();

// Scheduled build purge is opt-in (ADR 0039): `SHELF_PURGE_TTL_DAYS` turns it on; unset leaves it off, so
// an upgrade never starts deleting builds. A value that is not a positive whole number stops the boot.
function purgeTtlDaysFromEnv(): number | undefined {
  const raw = readSetting(env, "SHELF_PURGE_TTL_DAYS");
  if (raw === undefined || raw === "") return undefined;
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new Error("SHELF_PURGE_TTL_DAYS must be a positive whole number of days");
  }
  return Number(raw);
}
const purgeTtlDays = purgeTtlDaysFromEnv();

mkdirSync(dataDir, { recursive: true });

const database = createSqliteDatabase(`${dataDir}/shelf.db`);
const { storage, log: storageLog } = storageFromEnv(env, dataDir);
// With FLY_SPRITES_TOKEN and SPRITE_BROWSER_SECRET set, `chromium@sprite` (a hibernating Fly Sprite,
// apps/fly-app/sprite/) is selectable beside the VM's own Chromium; unset, only the latter.
const sprite = spriteFromEnv(env);
const captureRunner = createCaptureRunner({
  browsers: browsersFor(sprite),
  // The runner reads SHELF_CAPTURE_CONCURRENCY itself; unset, it sizes from the VM's CPU and memory.
});

// AI insights (ADR 0016) only with ANTHROPIC_API_KEY set: text only, Haiku, a small daily budget.
// Unset, no `ai` is passed and the app answers `501 ai-disabled` with no AI UI, as before.
const ai = aiFromEnv(env);

// Observability first (noop unless OTEL_EXPORTER_OTLP_ENDPOINT is set).
const observability = await initObservabilityFromEnv();
const shelfLogger = createShelfLogger({ mixin: otelLogMixin });
// Which storage serves the objects: the origin of the endpoint only, never the bucket or a key.
shelfLogger.info(storageLog, "object storage");
// Only whether the Sprite is configured: its token, secret and URL never reach a log.
shelfLogger.info({ spriteBrowser: sprite !== null }, "remote browsers");
// Only the model in use (null while AI is off): the Anthropic key never reaches a log.
shelfLogger.info(aiLogFields(ai), "ai insights");

// Every built-in integration is registered (ADR 0049) and idle until a project configures it. With
// SHELF_SMTP_* set, the built-in `email` notifier is swapped for one that sends through that transport
// (undefined keeps invites out-of-band).
const emailSender = await smtpPresetFromEnv(env, shelfLogger);
// SHELF_INTEGRATIONS_DISABLED turns integrations off without code (#1126); an unknown kind stops startup.
const integrations = integrationsFromEnv(env);

// Git connections from the environment (ADR 0054, decision 9), so the demo's App can move to a
// configured connection: SHELF_GITHUB_APP_ID + SHELF_GITHUB_APP_PRIVATE_KEY[_FILE], and so on. Unset,
// there are none and the demo's deployed secrets are untouched.
const git = gitFromEnv(env);
shelfLogger.info(
  { gitConnections: (git.connections ?? []).map((connection) => connection.id) },
  "git connections",
);

const app = createShelfApp({
  database,
  storage,
  testing: { runner: captureRunner },
  git,
  ai,
  design: integrations.design,
  notifications: {
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
  },
  auth:
    // SHELF_ADMIN_PASSWORD without a valid SHELF_SECRET refuses to start (createShelfAuth throws); never auth off.
    authPassword
      ? createShelfAuth({
          db: database,
          secret: secret ?? "",
          baseURL: publicBaseUrl ?? `http://localhost:${port}`,
          passkeys: {},
          emailSender,
          fromEmail: smtpFrom,
          onAuthSystemEvent: createAuthSystemHook(),
          logger: shelfLogger,
          // Shared accounts that sign in and read but never write (#1274), comma-separated emails.
          readOnlyAccounts: parseReadOnlyAccounts(env["SHELF_READ_ONLY_ACCOUNTS"]),
        }).adapter
      : undefined,
  ui,
  logger: shelfLogger,
  observability,
  config: {
    secret,
    // Rotation: keep the old SHELF_SECRET here until stored credentials are re-encrypted.
    previousSecret: previousSecret === "" ? undefined : previousSecret,
    migrateCredentialsOnBoot: readSetting(env, "SHELF_SECRET_MIGRATE") === "true",
    adminToken,
    publicBaseUrl,
    ...(trustProxy === undefined ? {} : { trustProxy }),
    scratchDir: dataDir,
    ...(purgeTtlDays === undefined ? {} : { purgeTtlDays }),
    // Emit Server-Timing response headers (total + db/storage roll-ups).
    serverTiming: true,
  },
});

const logger = app.lifecycle.logger;

// The demo's one read-only account (#1275). The password is the Fly secret; it is never logged.
// Retried each minute because `storyshelf-ui` is created by the first upload, which can come
// after this boot; every run is idempotent and cheap.
async function provisionDemoViewer(): Promise<void> {
  try {
    const done = await ensureDemoViewer(databaseDeps(database), env["SHELF_DEMO_VIEWER_PASSWORD"]);
    if (done.userCreated || done.memberAdded || done.credentialSet)
      logger.info(done, "Demo viewer provisioned");
  } catch (err) {
    logger.error({ err }, "Demo viewer provisioning failed");
  }
}

/** Boot hooks, once the app is ready and before the port opens: the admin, then the demo viewer. */
async function bootHooks(): Promise<void> {
  if (ignoredOldNames.length > 0) {
    logger.warn(oldNamesAllowedFields(ignoredOldNames), OLD_NAMES_ALLOWED_MESSAGE);
  }
  if (authPassword) {
    await ensurePasswordAdmin(database, { email: authEmail, password: authPassword });
    logger.info({ email: authEmail }, "Local admin login enabled from SHELF_ADMIN_PASSWORD");
  }
  if (authPassword && env["SHELF_DEMO_VIEWER_PASSWORD"]) {
    await provisionDemoViewer();
    setInterval(() => {
      provisionDemoViewer().catch(() => {}); // Intentionally empty — it logs its own errors
    }, 60_000).unref();
  }
}

// Ready (a failed boot check stops the server before it listens), boot hooks, then the port. The
// host owns SIGINT/SIGTERM: SHELF_SHUTDOWN_GRACE_SECONDS bounds the drain and teardown.
const server = await startServer({
  app,
  port,
  handleSignals: true,
  ...(graceMs === undefined ? {} : { shutdownTimeoutMs: graceMs }),
  beforeListen: bootHooks,
});
logger.info({ port: server.port, dataDir }, "StoryShelf fly server listening");

// The process ends with the shutdown, so a handler that ignored its release cannot outlive it.
await server.closed;
// oxlint-disable-next-line unicorn/no-process-exit -- the executable owns the final exit
process.exit(0);
