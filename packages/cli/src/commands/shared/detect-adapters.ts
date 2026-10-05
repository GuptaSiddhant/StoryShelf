import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface DetectedAdapters {
  database?:
    | "sqlite"
    | "turso"
    | "better-sqlite3"
    | "bun-sqlite"
    | "d1"
    | "postgres"
    | "pg"
    | "neon"
    | "neon-http"
    | "vercel"
    | "pglite"
    | "mysql"
    | "planetscale"
    | "tidb";
  storage?: "local" | "s3" | "azure" | "gcs";
  queue?: "memory" | "sqs" | "redis" | "azure-storage-queues" | "azure-service-bus" | "gcp-pubsub";
  git?: "none" | "github" | "gitlab";
}

/**
 * Detect installed adapter choices from a project's package.json.
 *
 * Reads `dependencies` and `devDependencies` keys and maps them to the prompt
 * choices used by `server init` / `worker init`. Missing or malformed
 * package.json returns an empty object.
 *
 * @param dir - Absolute path to the scaffolded project directory.
 * @returns Detected adapter selections (partial).
 */
export function detectInstalledAdapters(dir: string): DetectedAdapters {
  const pkgPath = join(dir, "package.json");
  let raw: string;
  try {
    raw = readFileSync(pkgPath, "utf8");
  } catch {
    return {};
  }
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(raw) as typeof pkg;
  } catch {
    return {};
  }
  const deps = new Set<string>([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);

  const result: DetectedAdapters = {};

  if (deps.has("@storyshelf/db-mysql")) {
    result.database = detectMysqlFlavor(dir, deps);
  } else if (deps.has("@storyshelf/db-postgres")) {
    result.database = detectPostgresFlavor(dir, deps);
  } else if (deps.has("@storyshelf/db-turso")) {
    // Legacy package (see docs/deprecated.md) — upgrades to the turso preset.
    result.database = "turso";
  } else if (deps.has("@storyshelf/db-sqlite")) {
    result.database = detectSqliteFlavor(dir, deps);
  }

  if (deps.has("@storyshelf/storage-azure")) {
    result.storage = "azure";
  } else if (deps.has("@storyshelf/storage-gcs")) {
    result.storage = "gcs";
  } else if (deps.has("@storyshelf/storage-s3")) {
    result.storage = "s3";
  } else if (deps.has("@storyshelf/storage-local")) {
    result.storage = "local";
  }

  if (deps.has("@storyshelf/queue-azure")) {
    // One package serves both backends — disambiguate via the installed SDK.
    result.queue = deps.has("@azure/service-bus") ? "azure-service-bus" : "azure-storage-queues";
  } else if (deps.has("@storyshelf/queue-gcp")) {
    result.queue = "gcp-pubsub";
  } else if (deps.has("@storyshelf/queue-sqs")) {
    result.queue = "sqs";
  } else if (deps.has("@storyshelf/queue-redis")) {
    result.queue = "redis";
  } else if (deps.has("@storyshelf/worker")) {
    // worker present implies a queue; default to memory if no explicit queue dep but worker present
    // leave queue undefined so caller defaults to memory
  }

  if (deps.has("@storyshelf/git-github")) {
    result.git = "github";
  } else if (deps.has("@storyshelf/git-gitlab")) {
    result.git = "gitlab";
  }

  return result;
}

/**
 * Distinguish the `@storyshelf/db-sqlite` presets. Peer deps disambiguate
 * turso/better-sqlite3; `bun:sqlite` is a builtin and D1 has no marker dep,
 * so fall back to scanning generated sources for subpath imports.
 */
function detectSqliteFlavor(
  dir: string,
  deps: Set<string>,
): NonNullable<DetectedAdapters["database"]> {
  if (deps.has("better-sqlite3")) {
    return "better-sqlite3";
  }
  if (deps.has("@libsql/client")) {
    return "turso";
  }
  const sources = readGeneratedSources(dir);
  if (sources.includes("@storyshelf/db-sqlite/bun-sqlite")) {
    return "bun-sqlite";
  }
  if (sources.includes("@storyshelf/db-sqlite/d1")) {
    return "d1";
  }
  if (sources.includes("@storyshelf/db-sqlite/better-sqlite3")) {
    return "better-sqlite3";
  }
  if (sources.includes("@storyshelf/db-sqlite/turso")) {
    return "turso";
  }
  return "sqlite";
}

function detectPostgresFlavor(
  dir: string,
  deps: Set<string>,
): NonNullable<DetectedAdapters["database"]> {
  if (deps.has("pg")) {
    return "pg";
  }
  if (deps.has("@neondatabase/serverless")) {
    const sources = readGeneratedSources(dir);
    if (sources.includes("@storyshelf/db-postgres/neon-http")) return "neon-http";
    return "neon";
  }
  if (deps.has("@vercel/postgres")) return "vercel";
  if (deps.has("@electric-sql/pglite")) return "pglite";
  const sources = readGeneratedSources(dir);
  if (sources.includes("@storyshelf/db-postgres/pg")) return "pg";
  if (sources.includes("@storyshelf/db-postgres/neon-http")) return "neon-http";
  if (sources.includes("@storyshelf/db-postgres/neon")) return "neon";
  if (sources.includes("@storyshelf/db-postgres/vercel")) return "vercel";
  if (sources.includes("@storyshelf/db-postgres/pglite")) return "pglite";
  return "postgres";
}

function detectMysqlFlavor(
  dir: string,
  deps: Set<string>,
): NonNullable<DetectedAdapters["database"]> {
  if (deps.has("@planetscale/database")) return "planetscale";
  if (deps.has("@tidbcloud/serverless")) return "tidb";
  if (deps.has("mysql2")) {
    const sources = readGeneratedSources(dir);
    if (sources.includes("@storyshelf/db-mysql/planetscale")) return "planetscale";
    if (sources.includes("@storyshelf/db-mysql/tidb")) return "tidb";
    return "mysql";
  }
  const sources = readGeneratedSources(dir);
  if (sources.includes("@storyshelf/db-mysql/planetscale")) return "planetscale";
  if (sources.includes("@storyshelf/db-mysql/tidb")) return "tidb";
  return "mysql";
}

function readGeneratedSources(dir: string): string {
  let sources = "";
  for (const file of ["server.ts", "worker.ts"]) {
    try {
      sources += readFileSync(join(dir, file), "utf8");
    } catch {
      // absent — ignore
    }
  }
  return sources;
}
