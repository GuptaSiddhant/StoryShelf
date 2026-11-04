declare const __PKG_VERSION__: string;

import { SCAFFOLD_DEV_DEPENDENCIES, SERVER_ENTRY } from "../../shared/scaffold.ts";
import {
  needsCompose,
  resolveDeployTarget,
  wantsDesign,
  wantsGit,
  wantsNotifications,
  wantsObservability,
  type Answers,
  type AuthChoice,
  type DatabaseChoice,
  type StorageChoice,
} from "./answers.ts";

/** DB peer SDK pins (must match db-* peerDependencies). */
const LIBSQL_CLIENT_SDK = "^0.15.0";
const BETTER_SQLITE3_SDK = "^12.0.0";
const PG_SDK = "^8.0.0";
const NEON_SDK = "^1.1.0";
const VERCEL_POSTGRES_SDK = "^0.10.0";
const PGLITE_SDK = "^0.5.8";
const MYSQL2_SDK = "^3.9.0";
const PLANETSCALE_SDK = "^1.19.0";
const TIDBCLOUD_SDK = "^0.1.0";
/** Email peer SDK pin (must match @storyshelf/notify-email peerDependencies). */
const NODEMAILER_SDK = "^10.0.12";

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

const STORAGE_PACKAGE: Record<StorageChoice, string> = {
  local: "@storyshelf/storage-local",
  s3: "@storyshelf/storage-s3",
  azure: "@storyshelf/storage-azure",
  gcs: "@storyshelf/storage-gcs",
};

const AUTH_PACKAGE: Record<AuthChoice, string | null> = {
  none: null,
  password: "@storyshelf/auth",
  oauth: "@storyshelf/auth",
};

function buildDeps(answers: Answers): Record<string, string> {
  const deps: Record<string, string> = {
    "@hono/node-server": "^1.17.0",
    "@storyshelf/app": __PKG_VERSION__ ?? "0.0.0",
    [DB_PACKAGE[answers.database]]: __PKG_VERSION__ ?? "0.0.0",
  };
  if (wantsObservability(answers)) {
    deps["@storyshelf/core"] = __PKG_VERSION__ ?? "0.0.0";
    deps["@storyshelf/observability"] = __PKG_VERSION__ ?? "0.0.0";
  }
  if (answers.database === "turso") {
    deps["@libsql/client"] = LIBSQL_CLIENT_SDK;
  }
  if (answers.database === "better-sqlite3") {
    deps["better-sqlite3"] = BETTER_SQLITE3_SDK;
  }
  if (answers.database === "pg") {
    deps["pg"] = PG_SDK;
  }
  if (answers.database === "neon" || answers.database === "neon-http") {
    deps["@neondatabase/serverless"] = NEON_SDK;
  }
  if (answers.database === "vercel") {
    deps["@vercel/postgres"] = VERCEL_POSTGRES_SDK;
  }
  if (answers.database === "pglite") {
    deps["@electric-sql/pglite"] = PGLITE_SDK;
  }
  if (answers.database === "mysql") {
    deps["mysql2"] = MYSQL2_SDK;
  }
  if (answers.database === "planetscale") {
    deps["@planetscale/database"] = PLANETSCALE_SDK;
  }
  if (answers.database === "tidb") {
    deps["@tidbcloud/serverless"] = TIDBCLOUD_SDK;
  }

  if (answers.storage !== "local") {
    deps[STORAGE_PACKAGE[answers.storage]] = __PKG_VERSION__ ?? "0.0.0";
  }
  deps["@storyshelf/runner-playwright"] = __PKG_VERSION__ ?? "0.0.0";
  if (answers.auth !== "none") {
    deps[AUTH_PACKAGE[answers.auth] ?? ""] = __PKG_VERSION__ ?? "0.0.0";
  }
  if (wantsGit(answers)) {
    deps["@storyshelf/notify-git"] = __PKG_VERSION__ ?? "0.0.0";
  }
  if (wantsDesign(answers)) {
    deps["@storyshelf/design-figma"] = __PKG_VERSION__ ?? "0.0.0";
  }
  if (wantsNotifications(answers)) {
    deps["@storyshelf/notify-chat"] = __PKG_VERSION__ ?? "0.0.0";
    deps["@storyshelf/notify-email"] = __PKG_VERSION__ ?? "0.0.0";
    deps["nodemailer"] = NODEMAILER_SDK;
  }

  return deps;
}

function addInfraScripts(scripts: Record<string, string>): void {
  scripts["infra:init"] = "terraform -chdir=terraform init";
  scripts["infra:plan"] = "terraform -chdir=terraform plan -out=tfplan";
  scripts["infra:apply"] = "terraform -chdir=terraform apply tfplan";
  scripts["infra:destroy"] = "terraform -chdir=terraform destroy";
  scripts["infra:outputs"] = "terraform -chdir=terraform output -json";
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
  return {
    "docker:build": `docker build -t ${answers.name} .`,
    "docker:run": `docker run --rm -p 3000:3000 -v ${answers.name}-data:/data -e SECRET=change-me ${answers.name}`,
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
    scripts: {
      start: `node ${SERVER_ENTRY}`,
      dev: `node --watch ${SERVER_ENTRY}`,
      typecheck: "tsc",
    } as Record<string, string>,
    dependencies: buildDeps(answers),
    devDependencies: SCAFFOLD_DEV_DEPENDENCIES,
  };

  if (resolveDeployTarget(answers) === "docker") {
    Object.assign(pkg.scripts, dockerScripts(answers));
  }

  if (
    resolveDeployTarget(answers) === "aws" ||
    resolveDeployTarget(answers) === "azure" ||
    resolveDeployTarget(answers) === "gcp"
  ) {
    addInfraScripts(pkg.scripts as Record<string, string>);
  }

  return JSON.stringify(pkg, null, 2);
}
