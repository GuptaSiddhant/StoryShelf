// Must load first: tsyringe (via @peculiar/x509 in passkey auth) throws at import without it, and the
// bundler does not preserve the transitive side-effect import.
import "reflect-metadata";
import { serve } from "@hono/node-server";
import { createAuthSystemHook, createShelfApp } from "@storyshelf/app";
import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";
import { parseReadOnlyAccounts } from "@storyshelf/core/auth";
import type { AuthUiConfig, UIConfig } from "@storyshelf/core/config";
import {
  parseTrustProxy,
  readSetting,
  renamedSettingsIn,
  warnRenamedSettings,
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
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";
/**
 * Fly demo server — SQLite on the volume, objects on the volume or in S3-compatible storage.
 *
 * Bundled by rolldown from workspace sources (`rolldown.config.ts`), so it
 * deploys whatever is on `main` with no publish step. `nub run dev` runs this
 * file from source instead.
 *
 * Mirrors apps/dev-server/src/server.ts wiring:
 *  - @storyshelf/db-sqlite → {SHELF_DATA_DIR}/shelf.db
 *  - @storyshelf/storage-local → SHELF_DATA_DIR, or @storyshelf/storage-s3 (Tigris) when SHELF_S3_BUCKET is set
 *  - @storyshelf/runner-playwright → chrome-headless-shell installed in the image
 *
 * Capture stays in-process: the 1-CPU Fly VM is below the threshold where
 * core would fork a capture child, so a `testing.workerEntry` would never apply.
 */
import { mkdirSync } from "node:fs";
import { aiFromEnv, aiLogFields } from "./ai.ts";
import { refuseLegacyVariables } from "./legacy-env.ts";
import { exitBy, shutdownGraceMs } from "./shutdown.ts";
import { browsersFor, spriteFromEnv } from "./sprite.ts";
import { storageFromEnv } from "./storage.ts";

const env = process.env;
refuseLegacyVariables(env);
// Old variable names still work (#1308), so the demo's existing Fly secrets keep booting it: two
// names of one setting set to different values stop boot here; each old name is logged below.
renamedSettingsIn(env);
const smtpFrom = readSetting(env, "SHELF_SMTP_FROM");
const previousSecret = readSetting(env, "SHELF_SECRET_PREVIOUS");
const dataDir = readSetting(env, "SHELF_DATA_DIR") ?? "/data";
const port = Number(env["PORT"] ?? 3000);
const secret = readSetting(env, "SHELF_SECRET");
const authPassword = readSetting(env, "SHELF_ADMIN_PASSWORD");
const authEmail = readSetting(env, "SHELF_ADMIN_EMAIL") ?? "admin@example.com";
const adminToken = readSetting(env, "SHELF_ADMIN_TOKEN");
const publicBaseUrl = readSetting(env, "SHELF_PUBLIC_BASE_URL");
// Bound of the SIGTERM drain: jobs still running then are handed back for another machine (#912).
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
const captureRunner = createPlaywrightCaptureRunner({
  browsers: browsersFor(sprite),
  // The runner reads SHELF_CAPTURE_CONCURRENCY itself; unset, it sizes from the VM's CPU and memory.
});

// AI insights (ADR 0016) only with ANTHROPIC_API_KEY set: text only, Haiku, a small daily budget.
// Unset, no `ai` is passed and the app answers `501 ai-disabled` with no AI UI, as before.
const ai = aiFromEnv(env);

// Observability first (noop unless OTEL_EXPORTER_OTLP_ENDPOINT is set).
const observability = await initObservabilityFromEnv();
const shelfLogger = createShelfLogger({ mixin: otelLogMixin });
warnRenamedSettings(env, shelfLogger);
// Which storage serves the objects: the origin of the endpoint only, never the bucket or a key.
shelfLogger.info(storageLog, "object storage");
// Only whether the Sprite is configured: its token, secret and URL never reach a log.
shelfLogger.info({ spriteBrowser: sprite !== null }, "remote browsers");
// Only the model in use (null while AI is off): the Anthropic key never reaches a log.
shelfLogger.info(aiLogFields(ai), "ai insights");

// Every built-in integration is registered (ADR 0049) and idle until a project configures it. With
// SMTP_* set, the built-in `email` notifier is swapped for one that sends through that transport
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

await app.lifecycle.setup();
const logger = app.lifecycle.logger;

if (authPassword) {
  await ensurePasswordAdmin(database, { email: authEmail, password: authPassword });
  logger.info({ email: authEmail }, "Local admin login enabled from SHELF_ADMIN_PASSWORD");
}

const server = serve({ fetch: app.fetch, port }, () => {
  logger.info({ port, dataDir }, "StoryShelf fly server listening");
});

// Teardown is idempotent (SHELF_SHUTDOWN_GRACE_SECONDS bounds its job drain) and logs its own errors; close the listener either way.
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
