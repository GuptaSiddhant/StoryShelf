import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createShelfLogger } from "../src/logger.ts";
import { createShelfRouter } from "../src/index.tsx";
import type { DatabaseAdapter } from "../src/adapters/database.ts";
import type { StorageAdapter } from "../src/adapters/storage.ts";

const unreachable = async (): Promise<never> => {
  throw new Error("unreachable: this adapter is never used during spec generation");
};

/** Adapters that throw if touched — route registration alone yields the spec. */
const stubDatabase: DatabaseAdapter = {
  insert: unreachable,
  update: unreachable,
  get: unreachable,
  remove: unreachable,
  list: unreachable,
  count: unreachable,
  all: unreachable,
  migrate: unreachable,
  close: unreachable,
};

const stubStorage: StorageAdapter = {
  read: unreachable,
  write: unreachable,
  delete: unreachable,
  exists: unreachable,
  list: unreachable,
};

/**
 * Serialize the OpenAPI document for the full router and write it to disk.
 *
 * Uses the same `app.openapi()` registry that serves `GET /api/v1/openapi.json`,
 * so a schema that can't serialize (e.g. an unannotated `z.instanceof`) fails
 * the build instead of surfacing at runtime.
 *
 * @param outPath - Absolute or cwd-relative write target.
 */
async function generateOpenApi(outPath: string): Promise<void> {
  const app = createShelfRouter({
    database: stubDatabase,
    storage: stubStorage,
    logger: createShelfLogger({ level: "silent" }),
  });

  const response = await app.request("/api/v1/openapi.json");
  if (!response.ok) {
    throw new Error(`failed to generate OpenAPI spec: HTTP ${response.status}`);
  }
  const spec = (await response.json()) as object;

  const target = resolve(outPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  console.log(`openapi.json written to ${target}`);
}

const outFlagIndex = process.argv.indexOf("--out");
const outPath = outFlagIndex >= 0 ? process.argv[outFlagIndex + 1] : undefined;

if (!outPath) {
  console.error("usage: nub ./scripts/generate-openapi.ts --out <path>");
  process.exitCode = 1;
} else {
  generateOpenApi(outPath).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}