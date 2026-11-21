// oxlint-disable max-statements curly no-console
// Boots the PUBLISHED previous release (installed from npm into a scratch directory, never from
// this checkout) on a database, and smokes it: health, project list, a project write, a read-back
// of that write, the root page. ADR 0053 decision 8, steps 1 and 3.
//
// Usage (from the scratch directory): node smoke-previous.mjs <sqlite|postgres> <seed|expect>
//   seed   an empty database: the release migrates it and one project is created.
//   expect a database the pull request's code already migrated: the release must start (skipping
//          its migrations), still read the project the first run created, and write another.
// Env: DATABASE_URL (postgres) or DATA_DIR (sqlite).
import { createShelfApp } from "@storyshelf/app";
import { mkdirSync } from "node:fs";

// 0.15.0 moved local storage into core; older releases ship it as `@storyshelf/storage-local`.
const { createLocalStorage } = await import("@storyshelf/core/storage/local").catch(
  () => import("@storyshelf/storage-local"),
);
const [dialect, phase] = process.argv.slice(2);
const dataDir = process.env["DATA_DIR"] ?? ".data";
mkdirSync(dataDir, { recursive: true });

async function openDatabase() {
  if (dialect === "sqlite") {
    const { createSqliteDatabase } = await import("@storyshelf/db-sqlite");
    return createSqliteDatabase(`${dataDir}/shelf.db`);
  }
  if (dialect === "postgres") {
    const { createPostgresDatabase } = await import("@storyshelf/db-postgres");
    return createPostgresDatabase({ url: process.env["DATABASE_URL"] });
  }
  throw new Error(`unknown dialect: ${dialect}`);
}

function fail(message) {
  throw new Error(`previous-release smoke FAILED (${dialect}, ${phase}): ${message}`);
}

const app = createShelfApp({
  database: await openDatabase(),
  storage: createLocalStorage(dataDir),
  config: { scratchDir: dataDir },
});

async function call(path, init) {
  const response = await app.request(path, init);
  const text = await response.text();
  if (!response.ok) fail(`${init?.method ?? "GET"} ${path} answered ${response.status}: ${text}`);
  return text;
}

async function createProject(name) {
  const body = await call("/api/v1/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return JSON.parse(body).slug;
}

try {
  await app.lifecycle.setup();
  await call("/api/v1/health");
  const before = JSON.parse(await call("/api/v1/projects")).length;
  if (phase === "seed" && before !== 0)
    fail(`expected an empty database, found ${before} projects`);
  if (phase === "expect" && before < 1) fail("the project written by the first run is gone");
  const slug = await createProject(`Compat ${phase}`);
  await call(`/api/v1/projects/${slug}`);
  const after = JSON.parse(await call("/api/v1/projects")).length;
  if (after !== before + 1) fail(`created a project but the list went ${before} -> ${after}`);
  if (!/html/iu.test(await call("/"))) fail("the root page is not HTML");
  console.log(`previous-release smoke OK (${dialect}, ${phase}): ${before} -> ${after} projects`);
} finally {
  await app.lifecycle.teardown();
}
