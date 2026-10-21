// Must load first: tsyringe (via @peculiar/x509 in passkey auth) throws at import without it, and the
// bundler does not preserve the transitive side-effect import.
import "reflect-metadata";
import { serve } from "@hono/node-server";
import { createAuthSystemHook, createShelfApp } from "@storyshelf/app";
import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";
import type { AuthUiConfig, UIConfig } from "@storyshelf/core/config";
import { createShelfLogger } from "@storyshelf/core/logger";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createFigmaDesign, figmaOAuthFromEnv } from "@storyshelf/design-figma";
import { chatNotifiers } from "@storyshelf/notify-chat";
import { createEmailNotifier, smtpPresetFromEnv } from "@storyshelf/notify-email";
import { otelLogMixin } from "@storyshelf/observability";
import { initObservabilityFromEnv } from "@storyshelf/observability/node";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";
import { createLocalStorage } from "@storyshelf/storage-local";
/**
 * Fly demo server — local adapters only.
 *
 * Bundled by rolldown from workspace sources (`rolldown.config.ts`), so it
 * deploys whatever is on `main` with no publish step. `nub run dev` runs this
 * file from source instead.
 *
 * Mirrors apps/dev-server/src/server.ts wiring:
 *  - @storyshelf/db-sqlite → {DATA_DIR}/shelf.db
 *  - @storyshelf/storage-local → DATA_DIR
 *  - @storyshelf/runner-playwright → chrome-headless-shell installed in the image
 *
 * Capture stays in-process: the 1-CPU Fly VM is below the threshold where
 * core would fork a capture child, so a `testing.workerEntry` would never apply.
 */
import { mkdirSync } from "node:fs";
import { seedDemo, type SeedAuth } from "./src/seed-demo.ts";

const env = process.env;
const dataDir = env["DATA_DIR"] ?? "/data";
const port = Number(env["PORT"] ?? 3000);
const secret = env["SECRET"];
const authPassword = env["AUTH_PASSWORD"];
const authEmail = env["AUTH_EMAIL"] ?? "admin@example.com";
const adminToken = env["STORYSHELF_ADMIN_TOKEN"] ?? env["ADMIN_TOKEN"];
const publicBaseUrl = env["PUBLIC_BASE_URL"];

function buildAuthUi(): AuthUiConfig | undefined {
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

function buildUi(): UIConfig | undefined {
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

/** How the demo seed authenticates its own uploads. */
function seedAuth(): SeedAuth {
  if (adminToken) {
    return { kind: "admin-token", token: adminToken };
  }
  return authPassword && secret ? { kind: "user", email: authEmail } : { kind: "none" };
}

mkdirSync(dataDir, { recursive: true });

const database = createSqliteDatabase(`${dataDir}/shelf.db`);
const storage = createLocalStorage(dataDir);
const captureRunner = createPlaywrightCaptureRunner({
  // Unset: sized from the VM's detected CPU and memory.
  concurrency: Number(env["CAPTURE_CONCURRENCY"]) || undefined,
});

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
  testing: { runner: captureRunner },
  design: [createFigmaDesign({ oauth: figmaOAuthFromEnv() })],
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
    scratchDir: dataDir,
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

// Seed the demo project through the real upload + capture pipeline, in the background so the
// health check passes meanwhile. Idempotent per fixture; other projects are never touched.
// oxlint-disable-next-line unicorn/prefer-top-level-await -- background seed after serve, must not block health check
seedDemo({ app, database, storage, logger, scratchDir: dataDir, auth: seedAuth() }).catch(
  (error: unknown) => {
    logger.error({ err: error }, "demo seed failed — serving irrespective");
  },
);

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
