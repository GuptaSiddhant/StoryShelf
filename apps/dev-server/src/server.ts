import { serve } from "@hono/node-server";
import { createAuthSystemHook, createShelfApp } from "@storyshelf/app";
import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";
import { parseShutdownGraceMs, parseTrustProxy } from "@storyshelf/core/config";
import { createEmailNotifier, smtpPresetFromEnv } from "@storyshelf/core/integrations";
import { createShelfLogger } from "@storyshelf/core/logger";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { otelLogMixin } from "@storyshelf/observability";
import { initObservabilityFromEnv } from "@storyshelf/observability/node";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";
import { createLocalStorage } from "@storyshelf/storage-local";
/**
 * Local StoryShelf dev server.
 *
 * Runs directly from TypeScript source with NO build step: `nub watch` applies
 * the `conditions: ["development"]` custom condition from `nub.jsonc`, which
 * resolves every `@storyshelf/*` import to its `.ts`/`.tsx` source (the
 * `source` export condition) via the isolated workspace linker. Node 24+ strips
 * types natively, so the whole monorepo is served straight from `src/`.
 *
 * Start it with `nub run serve` from the repo root (auto-restarts on change).
 */
import { mkdirSync } from "node:fs";

const env = process.env;
// The SS_* names were renamed to SHELF_* with no aliases (#948); refuse to boot while one is still set.
// Mirrors apps/fly-app/legacy-env.ts.
const LEGACY_PREFIX = "SS_";
const legacy = Object.keys(env).filter((name) => name.startsWith(LEGACY_PREFIX));
if (legacy.length > 0) {
  throw new Error(
    `StoryShelf no longer reads the SS_* variables. Rename them, then start again:\n${legacy
      .map((name) => `  ${name} -> ${name.replace(/^SS_/u, "SHELF_")}`)
      .join("\n")}`,
  );
}
const dataDir = env["DATA_DIR"] ?? ".dev-data";
const port = Number(env["PORT"] ?? 3000);
const secret = env["SECRET"];
const authPassword = env["AUTH_PASSWORD"];
const authEmail = env["AUTH_EMAIL"] ?? "admin@example.com";
const adminToken = env["STORYSHELF_ADMIN_TOKEN"] ?? env["ADMIN_TOKEN"];
const publicBaseUrl = env["PUBLIC_BASE_URL"];
// Proxies allowed to name the client for rate limits (#911); unset trusts none.
const trustProxy = parseTrustProxy(env["TRUST_PROXY"]);

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

function buildAuthUi(): Record<string, string> | undefined {
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

function buildUi(): Record<string, unknown> | undefined {
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

// Ensure the data directory exists for the sqlite file and storage.
mkdirSync(dataDir, { recursive: true });

// Adapters — swap these to try other combinations.
const database = createSqliteDatabase(`${dataDir}/shelf.db`);
const storage = createLocalStorage(dataDir);
const captureRunner = createPlaywrightCaptureRunner();

const ui = buildUi();

// Observability first (noop unless OTEL_EXPORTER_OTLP_ENDPOINT is set);
// the pino mixin correlates every log line with the active trace.
const observability = await initObservabilityFromEnv();
const shelfLogger = createShelfLogger({ mixin: otelLogMixin });

// Every built-in integration is registered (ADR 0049) and idle until a project configures it. With
// SMTP_* set, the built-in `email` notifier is swapped for one that sends through that transport
// (undefined keeps invites out-of-band).
const emailSender = await smtpPresetFromEnv(env, shelfLogger);

const app = createShelfApp({
  database,
  storage,
  testing: { runner: captureRunner },
  notifications: {
    notifiers: (builtIn) =>
      emailSender
        ? builtIn.map((provider) =>
            provider.metadata.kind === "email"
              ? createEmailNotifier(emailSender, { from: env["SMTP_FROM"] })
              : provider,
          )
        : builtIn,
    ...(env["SMTP_FROM"] ? { config: { fromEmail: env["SMTP_FROM"] } } : {}),
  },
  // Enable local-account login by setting AUTH_PASSWORD (and SECRET): the
  // engine provisions an admin identity from the env on every boot.
  // AUTH_PASSWORD must be at least 12 characters; AUTH_EMAIL overrides the
  // admin address (defaults to admin@example.com). No viewer tier exists anymore.
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
    // `SECRET` signs auth sessions; `scratchDir` is where an uploaded
    // Storybook archive is extracted before Playwright renders it.
    // `STORYSHELF_ADMIN_TOKEN` bootstraps site-admin API access.
    // `serverTiming` emits Server-Timing response headers (total + db/storage).
    secret,
    // Rotation: keep the old SECRET here until stored credentials are re-encrypted.
    previousSecret: env["SECRET_PREVIOUS"] === "" ? undefined : env["SECRET_PREVIOUS"],
    migrateCredentialsOnBoot: env["SECRET_MIGRATE"] === "true",
    adminToken,
    publicBaseUrl,
    ...(trustProxy === undefined ? {} : { trustProxy }),
    scratchDir: dataDir,
    ...(purgeTtlDays === undefined ? {} : { purgeTtlDays }),
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
  logger.info({ port, dataDir }, "StoryShelf dev server listening");
});

const shutdown = async (): Promise<void> => {
  await app.lifecycle.teardown({
    graceMs: parseShutdownGraceMs(process.env["SHUTDOWN_GRACE_SECONDS"]),
  });
  server.close();
};
process.on("SIGTERM", () => {
  shutdown().catch(() => {}); // Intentionally empty — shutdown errors are already logged
});
process.on("SIGINT", () => {
  shutdown().catch(() => {}); // Intentionally empty — shutdown errors are already logged
});
