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
  git?: "none" | "git";
}

/**
 * Detect installed adapter choices from a project's package.json.
 *
 * Reads `dependencies` and `devDependencies` keys and maps them to the prompt
 * choices used by `server init`. Missing or malformed
 * package.json returns an empty object.
 *
 * @param dir - Absolute path to the scaffolded project directory.
 * @returns Detected adapter selections (partial).
 */
export function detectInstalledAdapters(dir: string): DetectedAdapters {
  const deps = readDependencyNames(dir);
  if (!deps) {
    return {};
  }
  return { ...detectDatabase(dir, deps), ...detectStorage(dir, deps), ...detectGit(deps) };
}

type Database = NonNullable<DetectedAdapters["database"]>;

/** Every dependency name of the project's package.json, or undefined when it is missing or malformed. */
function readDependencyNames(dir: string): Set<string> | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
  } catch {
    return undefined;
  }
}

/** The generated sources, read only when a dependency alone does not settle the flavor. */
type ReadSources = () => string;

/** How one `@storyshelf/db-*` package is told apart: marker dependencies first, then subpath imports. */
interface FlavorRules {
  /** The subpath prefix generated sources import presets from. */
  prefix: string;
  /** Marker dependencies, in order; a function decides from the sources. */
  deps: readonly (readonly [string, Database | ((sources: ReadSources) => Database)])[];
  /** Subpath imports found in the generated sources, in order. */
  sources: readonly (readonly [string, Database])[];
  fallback: Database;
}

/**
 * The `@storyshelf/db-sqlite` presets. Peer deps disambiguate turso/better-sqlite3; `bun:sqlite` is
 * a builtin and D1 has no marker dep, so fall back to scanning generated sources for subpath imports.
 */
const SQLITE_RULES: FlavorRules = {
  prefix: "@storyshelf/db-sqlite",
  deps: [
    ["better-sqlite3", "better-sqlite3"],
    ["@libsql/client", "turso"],
  ],
  sources: [
    ["bun-sqlite", "bun-sqlite"],
    ["d1", "d1"],
    ["better-sqlite3", "better-sqlite3"],
    ["turso", "turso"],
  ],
  fallback: "sqlite",
};

const POSTGRES_RULES: FlavorRules = {
  prefix: "@storyshelf/db-postgres",
  deps: [
    ["pg", "pg"],
    [
      "@neondatabase/serverless",
      (sources) => (sources().includes("@storyshelf/db-postgres/neon-http") ? "neon-http" : "neon"),
    ],
    ["@vercel/postgres", "vercel"],
    ["@electric-sql/pglite", "pglite"],
  ],
  sources: [
    ["pg", "pg"],
    ["neon-http", "neon-http"],
    ["neon", "neon"],
    ["vercel", "vercel"],
    ["pglite", "pglite"],
  ],
  fallback: "postgres",
};

const MYSQL_RULES: FlavorRules = {
  prefix: "@storyshelf/db-mysql",
  deps: [
    ["@planetscale/database", "planetscale"],
    ["@tidbcloud/serverless", "tidb"],
  ],
  sources: [
    ["planetscale", "planetscale"],
    ["tidb", "tidb"],
  ],
  fallback: "mysql",
};

/** The database package that is installed, in precedence order, and its flavor. */
const DATABASE_PACKAGES: readonly (readonly [string, Database | FlavorRules])[] = [
  ["@storyshelf/db-mysql", MYSQL_RULES],
  ["@storyshelf/db-postgres", POSTGRES_RULES],
  // Legacy package (see docs/deprecated.md) — upgrades to the turso preset.
  ["@storyshelf/db-turso", "turso"],
  ["@storyshelf/db-sqlite", SQLITE_RULES],
];

function detectDatabase(dir: string, deps: Set<string>): Pick<DetectedAdapters, "database"> {
  const found = DATABASE_PACKAGES.find(([name]) => deps.has(name))?.[1];
  if (found === undefined) {
    return {};
  }
  return { database: typeof found === "string" ? found : detectFlavor(dir, deps, found) };
}

function detectFlavor(dir: string, deps: Set<string>, rules: FlavorRules): Database {
  const sources: ReadSources = () => readGeneratedSources(dir);
  const marker = rules.deps.find(([name]) => deps.has(name))?.[1];
  if (marker !== undefined) {
    return typeof marker === "function" ? marker(sources) : marker;
  }
  const text = sources();
  const imported = rules.sources.find(([subpath]) => text.includes(`${rules.prefix}/${subpath}`));
  return imported?.[1] ?? rules.fallback;
}

/** The cloud SDK a project installs for `@storyshelf/storage`, in precedence order, and its backend. */
const STORAGE_SDKS: readonly (readonly [string, "azure" | "gcs" | "s3"])[] = [
  ["@azure/storage-blob", "azure"],
  ["@google-cloud/storage", "gcs"],
  ["@aws-sdk/client-s3", "s3"],
];

/** The storage subpaths, in precedence order, read from generated sources when no SDK marks one. */
const STORAGE_SUBPATHS = ["azure", "gcs", "s3"] as const;

function detectStorage(dir: string, deps: Set<string>): Pick<DetectedAdapters, "storage"> {
  if (deps.has("@storyshelf/storage")) {
    const marker = STORAGE_SDKS.find(([name]) => deps.has(name))?.[1];
    const text = marker === undefined ? readGeneratedSources(dir) : "";
    const imported = STORAGE_SUBPATHS.find((path) => text.includes(`@storyshelf/storage/${path}`));
    return { storage: marker ?? imported ?? "s3" };
  }
  // Deprecated re-export of `@storyshelf/core/storage/local` (ADR 0049); still detected as local.
  return deps.has("@storyshelf/storage-local") ? { storage: "local" } : {};
}

function detectGit(deps: Set<string>): Pick<DetectedAdapters, "git"> {
  // Git hosts are built into the app (ADR 0049).
  return deps.has("@storyshelf/app") ? { git: "git" } : {};
}

function readGeneratedSources(dir: string): string {
  let sources = "";
  for (const file of ["src/index.ts", "server.ts"]) {
    try {
      sources += readFileSync(join(dir, file), "utf8");
    } catch {
      // absent — ignore
    }
  }
  return sources;
}
