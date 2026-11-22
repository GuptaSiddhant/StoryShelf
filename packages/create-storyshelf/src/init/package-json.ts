import { ownVersion, peerRange } from "../manifest.ts";
import { SCAFFOLD_DEV_DEPENDENCIES, SERVER_ENTRY } from "../scaffold.ts";
import {
  needsCompose,
  resolveDeployTarget,
  wantsNotifications,
  wantsObservability,
  type Answers,
  type AuthChoice,
  type DatabaseChoice,
  type StorageChoice,
} from "./answers.ts";

const DB_PACKAGE: Record<DatabaseChoice, string> = {
  sqlite: "@storyshelf/db-sqlite",
  turso: "@storyshelf/db-sqlite",
  "better-sqlite3": "@storyshelf/db-sqlite",
  "bun-sqlite": "@storyshelf/db-sqlite",
  d1: "@storyshelf/db-sqlite",
  postgres: "@storyshelf/db-postgres",
  pg: "@storyshelf/db-postgres",
  neon: "@storyshelf/db-postgres",
  "neon-http": "@storyshelf/db-postgres",
  vercel: "@storyshelf/db-postgres",
  pglite: "@storyshelf/db-postgres",
  mysql: "@storyshelf/db-mysql",
  planetscale: "@storyshelf/db-mysql",
  tidb: "@storyshelf/db-mysql",
};

/** Local storage is built into `@storyshelf/core/storage/local` (ADR 0049), so it has no package. */
const STORAGE_PACKAGE = "@storyshelf/storage";

/** The cloud SDKs a backend needs: optional peers of `@storyshelf/storage`, which the scaffold installs. */
const STORAGE_SDKS: Record<Exclude<StorageChoice, "local">, readonly string[]> = {
  s3: ["@aws-sdk/client-s3", "@aws-sdk/lib-storage"],
  azure: ["@azure/identity", "@azure/storage-blob"],
  gcs: ["@google-cloud/storage"],
};

const AUTH_PACKAGE: Record<AuthChoice, string | null> = {
  none: null,
  password: "@storyshelf/auth",
  oauth: "@storyshelf/auth",
};

/**
 * The optional peer SDK a database preset needs. `mysql2` is a dependency of `@storyshelf/db-mysql`,
 * so the mysql presets name none.
 */
const DB_SDK: Partial<Record<DatabaseChoice, string>> = {
  turso: "@libsql/client",
  "better-sqlite3": "better-sqlite3",
  pg: "pg",
  neon: "@neondatabase/serverless",
  "neon-http": "@neondatabase/serverless",
  vercel: "@vercel/postgres",
  pglite: "@electric-sql/pglite",
  planetscale: "@planetscale/database",
  tidb: "@tidbcloud/serverless",
};

/** The given StoryShelf packages, all at the version of this CLI. */
function ownPackages(names: readonly string[]): Record<string, string> {
  const version = ownVersion();
  return Object.fromEntries(names.map((name) => [name, version]));
}

/** The app, core (a peer of every adapter, so never left to chance), the database package and observability. */
function coreNames(answers: Answers): string[] {
  return [
    "@storyshelf/app",
    "@storyshelf/core",
    DB_PACKAGE[answers.database],
    ...(wantsObservability(answers) ? ["@storyshelf/observability"] : []),
  ];
}

/** The storage, runner and auth packages the answers ask for (integrations are built in). */
function featureNames(answers: Answers): string[] {
  const auth = AUTH_PACKAGE[answers.auth];
  return [
    ...(answers.storage === "local" ? [] : [STORAGE_PACKAGE]),
    "@storyshelf/runner",
    ...(auth === null ? [] : [auth]),
  ];
}

/** The peer SDKs the answers need, at the range their owner declares in the manifest. */
function sdkPins(answers: Answers): Record<string, string> {
  const db = DB_SDK[answers.database];
  const pins: [string, string][] = [];
  if (db !== undefined) pins.push([db, peerRange(DB_PACKAGE[answers.database], db)]);
  if (answers.storage !== "local") {
    for (const sdk of STORAGE_SDKS[answers.storage])
      pins.push([sdk, peerRange(STORAGE_PACKAGE, sdk)]);
  }
  if (wantsNotifications(answers))
    pins.push(["nodemailer", peerRange("@storyshelf/core", "nodemailer")]);
  return Object.fromEntries(pins);
}

function buildDeps(answers: Answers): Record<string, string> {
  return {
    ...ownPackages(coreNames(answers)),
    ...ownPackages(featureNames(answers)),
    ...sdkPins(answers),
  };
}

/** `docker:*` npm scripts: compose when several services, plain `docker` for one container. */
function dockerScripts(answers: Answers): Record<string, string> {
  if (needsCompose(answers)) {
    return {
      "docker:build": "docker compose build",
      "docker:up": "docker compose up --build",
      "docker:down": "docker compose down",
      "docker:logs": "docker compose logs -f",
    };
  }
  // Forward the operator's SHELF_SECRET (and SHELF_ADMIN_PASSWORD) from the shell: a literal here would be
  // shorter than 32 characters, and the server refuses to start with it.
  const env =
    answers.auth === "password" ? "-e SHELF_SECRET -e SHELF_ADMIN_PASSWORD" : "-e SHELF_SECRET";
  return {
    "docker:build": `docker build -t ${answers.name} .`,
    "docker:run": `docker run --rm -p 3000:3000 -v ${answers.name}-data:/data ${env} ${answers.name}`,
  };
}

/** The npm scripts: start, dev and typecheck, plus the Docker ones of the deploy target. */
function scriptsFor(answers: Answers): Record<string, string> {
  const target = resolveDeployTarget(answers);
  return {
    start: "storyshelf-server serve",
    dev: "storyshelf-server serve --watch",
    typecheck: "tsc",
    ...(target === "docker" ? dockerScripts(answers) : {}),
  };
}

export function generatePackageJson(answers: Answers): string {
  const pkg = {
    name: answers.name,
    version: "0.1.0",
    type: "module",
    private: true,
    description: "StoryShelf self-hosted visual testing server.",
    engines: { node: ">=24" },
    // Where \`storyshelf-server\` finds the instance module.
    storyshelf: { server: SERVER_ENTRY },
    scripts: scriptsFor(answers),
    dependencies: buildDeps(answers),
    devDependencies: SCAFFOLD_DEV_DEPENDENCIES,
  };
  return JSON.stringify(pkg, null, 2);
}
