import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface DetectedAdapters {
  database?: "sqlite" | "turso" | "postgres";
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

  if (deps.has("@storyshelf/db-turso")) {
    result.database = "turso";
  } else if (deps.has("@storyshelf/db-postgres")) {
    result.database = "postgres";
  } else if (deps.has("@storyshelf/db-sqlite")) {
    result.database = "sqlite";
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
