import { serve } from "@hono/node-server";
import { createShelfApp } from "@storyshelf/app";
import { createPasswordAuth } from "@storyshelf/auth-password";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";
import { createLocalStorage } from "@storyshelf/storage-local";
/**
 * Local StoryShelf dev server.
 *
 * Runs directly from TypeScript source with NO build step: `nub watch` applies
 * the `conditions: ["development"]` custom condition from `nub.jsonc`, which
 * resolves every `@storyshelf/*` import to its `.ts`/`.tsx` source (the
 * `source` export condition) via the isolated workspace linker. Node 26 strips
 * types natively, so the whole monorepo is served straight from `src/`.
 *
 * Start it with `nub run serve` from the repo root (auto-restarts on change).
 */
import { mkdirSync } from "node:fs";

const env = process.env;
const dataDir = env["DATA_DIR"] ?? ".dev-data";
const port = Number(env["PORT"] ?? 3000);
const secret = env["SECRET"];
const authPassword = env["AUTH_PASSWORD"];
const authViewerPassword = env["AUTH_VIEWER_PASSWORD"];
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
  const favicon = env["SS_FAVICON_URL"];
  const auth = buildAuthUi();
  const hasBrand = Boolean(name ?? logo ?? favicon);
  if (!hasBrand && !auth) {
    return undefined;
  }
  return {
    ...(name ? { name } : {}),
    ...(logo ? { logo } : {}),
    ...(favicon ? { favicon } : {}),
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

const app = createShelfApp({
  database,
  storage,
  captureRunner,
  // Enable a shared-password login by setting AUTH_PASSWORD (and SECRET).
  // Optional tiered demo: AUTH_VIEWER_PASSWORD → viewer role (read-only).
  auth:
    authPassword && secret
      ? createPasswordAuth({ password: authPassword, viewerPassword: authViewerPassword, secret })
      : undefined,
  ui: ui as never,
  config: {
    // `SECRET` signs auth sessions; `scratchDir` is where an uploaded
    // Storybook archive is extracted before Playwright renders it.
    // `STORYSHELF_ADMIN_TOKEN` bootstraps site-admin API access.
    secret,
    adminToken,
    publicBaseUrl,
    scratchDir: dataDir,
  },
});

await app.lifecycle.setup();
const logger = app.lifecycle.logger;

const server = serve({ fetch: app.fetch, port }, () => {
  logger.info({ port, dataDir }, "StoryShelf dev server listening");
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
