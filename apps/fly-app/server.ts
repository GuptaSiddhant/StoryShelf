// Must load first: tsyringe (via @peculiar/x509 in passkey auth) throws at import without it, and the
// bundler does not preserve the transitive side-effect import.
import "reflect-metadata";
import { serve } from "@hono/node-server";
import { createAuthSystemHook, createShelfApp } from "@storyshelf/app";
import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";
import { createShelfLogger } from "@storyshelf/core/logger";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { chatNotifiers } from "@storyshelf/notify-chat";
import { createEmailNotifier, smtpPresetFromEnv } from "@storyshelf/notify-email";
import { otelLogMixin } from "@storyshelf/observability";
import { initObservabilityFromEnv } from "@storyshelf/observability/node";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";
import { createLocalStorage } from "@storyshelf/storage-local";
/**
 * Fly demo server — local adapters only.
 *
 * Runs from TypeScript source via Node 26 --experimental-transform-types
 * + `source` export condition (NODE_OPTIONS=--conditions=source). Uses
 * workspace packages directly (no publish step), so deploys whatever is
 * at the tagged commit.
 *
 * Mirrors apps/dev-server/src/server.ts wiring:
 *  - @storyshelf/db-sqlite → {DATA_DIR}/shelf.db
 *  - @storyshelf/storage-local → DATA_DIR
 *  - @storyshelf/runner-playwright → Chromium via playwright base image
 */
import { mkdirSync } from "node:fs";
import { seedDemo } from "./src/seed-demo.ts";

const env = process.env;
const dataDir = env["DATA_DIR"] ?? "/data";
const port = Number(env["PORT"] ?? 3000);
const secret = env["SECRET"];
const authPassword = env["AUTH_PASSWORD"];
const authEmail = env["AUTH_EMAIL"] ?? "admin@local";
const adminToken = env["STORYSHELF_ADMIN_TOKEN"] ?? env["ADMIN_TOKEN"];
const publicBaseUrl = env["PUBLIC_BASE_URL"];

function buildAuthUi(): Record<string, string> | undefined {
  const pairs: Array<[string, string | undefined]> = [
    ["title", env["SS_AUTH_TITLE"]],
    ["subtitle", env["SS_AUTH_SUBTITLE"]],
    ["passwordLabel", env["SS_AUTH_PASSWORD_LABEL"]],
    ["passwordPlaceholder", env["SS_AUTH_PASSWORD_PLACEHOLDER"]],
    ["submitLabel", env["SS_AUTH_SUBMIT_LABEL"]],
    ["ssoLabelTemplate", env["SS_AUTH_SSO_LABEL"]],
    ["helpText", env["SS_AUTH_HELP_TEXT"]],
    ["footerText", env["SS_AUTH_FOOTER_TEXT"]],
  ];
  const out: Record<string, string> = {};
  for (const [key, value] of pairs) {
    if (value) {
      out[key] = value;
    }
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

function buildUi(): Record<string, unknown> | undefined {
  const name = env["SS_BRAND_NAME"];
  const logo = env["SS_LOGO_URL"];
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

mkdirSync(dataDir, { recursive: true });

const database = createSqliteDatabase(`${dataDir}/shelf.db`);
const storage = createLocalStorage(dataDir);
const captureRunner = createPlaywrightCaptureRunner();

// Observability first (noop unless OTEL_EXPORTER_OTLP_ENDPOINT is set).
const observability = await initObservabilityFromEnv();
const shelfLogger = createShelfLogger({ mixin: otelLogMixin });

// Notifications: SMTP sender from SMTP_* env (undefined keeps invites
// out-of-band); chat + email providers serve stored channels.
const emailSender = smtpPresetFromEnv(env, shelfLogger);
const emailNotifiers = emailSender
  ? [createEmailNotifier(emailSender, { from: env["SMTP_FROM"] })]
  : [];

const app = createShelfApp({
  database,
  storage,
  captureRunner,
  notifiers: [...chatNotifiers, ...emailNotifiers],
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
  ui: ui as never,
  logger: shelfLogger,
  observability,
  config: {
    secret,
    adminToken,
    publicBaseUrl,
    scratchDir: dataDir,
    // Emit Server-Timing response headers (total + db/storage roll-ups).
    serverTiming: true,
    ...(env["SMTP_FROM"] ? { notifications: { fromEmail: env["SMTP_FROM"] } } : {}),
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

// Always seed demo project in background — isolated to Demo Design System, other projects untouched. Serve irrespective.
// oxlint-disable-next-line unicorn/prefer-top-level-await -- background seed after serve, must not block health check
seedDemo({ database, storage, captureRunner, logger }).catch((error) => {
  logger.error({ err: error }, "demo seed failed — serving irrespective");
});

const shutdown = async (): Promise<void> => {
  await app.lifecycle.teardown();
  server.close();
};
process.on("SIGTERM", () => {
  shutdown().catch(() => {}); // Intentionally empty — shutdown errors are already logged
});
process.on("SIGINT", () => {
  shutdown().catch(() => {}); // Intentionally empty — shutdown errors are already logged
});
