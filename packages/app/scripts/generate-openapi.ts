import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { createShelfLogger } from "@storyshelf/core/logger";
import { stubTables } from "@storyshelf/core/test-helpers";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createShelfApp } from "../src/index.tsx";

const unreachable = (): Promise<never> => {
  throw new Error("unreachable: this adapter is never used during spec generation");
};

/** Adapters that throw if touched — route registration alone yields the spec. */
const stubDatabase: DatabaseAdapter = {
  metadata: { name: "Stub DB", version: "0.0.0", kind: "stub", category: "database" },
  tables: stubTables(),
  insert: unreachable,
  update: unreachable,
  updateWhere: unreachable,
  get: unreachable,
  remove: unreachable,
  list: unreachable,
  count: unreachable,
  all: unreachable,
};

const stubStorage: StorageAdapter = {
  metadata: { name: "Stub Storage", version: "0.0.0", kind: "stub", category: "storage" },
  read: unreachable,
  write: unreachable,
  delete: unreachable,
  exists: unreachable,
  list: unreachable,
  writeStream: unreachable,
  readStream: unreachable,
};

/**
 * Serialize the OpenAPI document for the full router and write it to disk.
 *
 * Uses the same `app.openapi()` registry that serves `GET /api/v1/openapi.json`,
 * so a schema that can't serialize (e.g. an unannotated `z.instanceof`) fails
 * the build instead of surfacing at runtime.
 *
 * Run from source, the document's `info.version` is "0.0.0" (the pinned snapshot keeps it so a release
 * never changes the snapshot). `--release-version` stamps `@storyshelf/app`'s own version instead,
 * which is what a built server serves; the website's copy uses it.
 *
 * @param outPath - Absolute or cwd-relative write target.
 * @param stampRelease - Replace `info.version` with the package's version.
 */
async function generateOpenApi(outPath: string, stampRelease: boolean): Promise<void> {
  const app = createShelfApp({
    database: stubDatabase,
    storage: stubStorage,
    logger: createShelfLogger({ level: "silent" }),
  });

  const response = await app.request("/api/v1/openapi.json");
  if (!response.ok) {
    throw new Error(`failed to generate OpenAPI spec: HTTP ${response.status}`);
  }
  const spec = (await response.json()) as { info: { version: string } };
  if (stampRelease) spec.info.version = await releaseVersion();

  const target = resolve(outPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  process.stdout.write(`openapi.json written to ${target}\n`);
}

/** `@storyshelf/app`'s version, from its `package.json`. */
async function releaseVersion(): Promise<string> {
  const manifest = await readFile(new URL("../package.json", import.meta.url), "utf8");
  return (JSON.parse(manifest) as { version: string }).version;
}

const outFlagIndex = process.argv.indexOf("--out");
const outPath = outFlagIndex >= 0 ? process.argv[outFlagIndex + 1] : undefined;

if (outPath) {
  try {
    await generateOpenApi(outPath, process.argv.includes("--release-version"));
  } catch (error: unknown) {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  }
} else {
  process.stderr.write(
    "usage: nub ./scripts/generate-openapi.ts --out <path> [--release-version]\n",
  );
  process.exitCode = 1;
}
