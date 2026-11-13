// Must load first: tsyringe (via @peculiar/x509 in passkey auth) throws at import without it, and the
// bundler does not preserve the transitive side-effect import.
import "reflect-metadata";
import { serve } from "@hono/node-server";
import { createAuthSystemHook, createShelfApp } from "@storyshelf/app";
import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";
import type { AuthUiConfig, UIConfig } from "@storyshelf/core/config";
import { parseTrustProxy } from "@storyshelf/core/config";
import { createEmailNotifier, smtpPresetFromEnv } from "@storyshelf/core/integrations";
import { createShelfLogger } from "@storyshelf/core/logger";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createFigmaDesign, figmaOAuthFromEnv } from "@storyshelf/design-figma";
import { chatNotifiers } from "@storyshelf/notify-chat";
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
 *  - @storyshelf/db-sqlite → {DATA_DIR}/shelf.db
 *  - @storyshelf/storage-local → DATA_DIR, or @storyshelf/storage-s3 (Tigris) when AWS_BUCKET is set
 *  - @storyshelf/runner-playwright → chrome-headless-shell installed in the image
 *
 * Capture stays in-process: the 1-CPU Fly VM is below the threshold where
 * core would fork a capture child, so a `testing.workerEntry` would never apply.
 */
import { mkdirSync } from "node:fs";
import { aiFromEnv, aiLogFields } from "./ai.ts";
import { refuseLegacyVariables } from "./legacy-env.ts";
import { browsersFor, spriteFromEnv } from "./sprite.ts";
import { storageFromEnv } from "./storage.ts";

const env = process.env;
refuseLegacyVariables(env);
const dataDir = env["DATA_DIR"] ?? "/data";
const port = Number(env["PORT"] ?? 3000);
const secret = env["SECRET"];
const authPassword = env["AUTH_PASSWORD"];
const authEmail = env["AUTH_EMAIL"] ?? "admin@example.com";
const adminToken = env["STORYSHELF_ADMIN_TOKEN"] ?? env["ADMIN_TOKEN"];
const publicBaseUrl = env["PUBLIC_BASE_URL"];
// Rate limits key on the client, not Fly's proxy (#911): on Fly (`FLY_APP_NAME` is set by the
// platform) trust `Fly-Client-IP` unless `TRUST_PROXY` says otherwise; `TRUST_PROXY=false` opts out.
const trustProxy =
  env["TRUST_PROXY"] === undefined && env["FLY_APP_NAME"]
    ? "fly"
    : parseTrustProxy(env["TRUST_PROXY"]);

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
  const out: Record<string, string> = {};
  for (const [key, value] of pairs) {
    if (value) {
      out[key] = value;
    }
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

// Scheduled build purge is opt-in (ADR 0039): `PURGE_TTL_DAYS` turns it on; unset leaves it off, so
// an upgrade never starts deleting builds. A value that is not a positive whole number stops the boot.
function purgeTtlDaysFromEnv(): number | undefined {
  const raw = env["PURGE_TTL_DAYS"];
  if (raw === undefined || raw === "") return undefined;
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new Error("PURGE_TTL_DAYS must be a positive whole number of days");
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
  // Unset: sized from the VM's detected CPU and memory.
  concurrency: Number(env["CAPTURE_CONCURRENCY"]) || undefined,
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

// Notifications: SMTP sender from SMTP_* env (undefined keeps invites
// out-of-band); chat + email providers serve stored channels.
const emailSender = await smtpPresetFromEnv(env, shelfLogger);
const emailNotifiers = emailSender
  ? [createEmailNotifier(emailSender, { from: env["SMTP_FROM"] })]
  : [];

const app = createShelfApp({
  database,
  storage,
  testing: { runner: captureRunner },
  design: [createFigmaDesign({ oauth: figmaOAuthFromEnv() })],
  ai,
  notifications: {
    notifiers: [...chatNotifiers, ...emailNotifiers],
    ...(env["SMTP_FROM"] ? { config: { fromEmail: env["SMTP_FROM"] } } : {}),
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
  ui,
  logger: shelfLogger,
  observability,
  config: {
    secret,
    // Rotation: keep the old SECRET here until stored credentials are re-encrypted.
    previousSecret: env["SECRET_PREVIOUS"] === "" ? undefined : env["SECRET_PREVIOUS"],
    migrateCredentialsOnBoot: env["SECRET_MIGRATE"] === "true",
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

if (authPassword && secret) {
  await ensurePasswordAdmin(database, { email: authEmail, password: authPassword });
  logger.info({ email: authEmail }, "Local admin login enabled from AUTH_PASSWORD");
}

const server = serve({ fetch: app.fetch, port }, () => {
  logger.info({ port, dataDir }, "StoryShelf fly server listening");
});

// Teardown is idempotent and logs its own errors; close the listener either way.
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
