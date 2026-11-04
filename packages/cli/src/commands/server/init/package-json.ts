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

/** The peer SDK a database preset needs, as package name and pinned range. */
const DB_SDK: Partial<Record<DatabaseChoice, readonly [string, string]>> = {
  turso: ["@libsql/client", LIBSQL_CLIENT_SDK],
  "better-sqlite3": ["better-sqlite3", BETTER_SQLITE3_SDK],
  pg: ["pg", PG_SDK],
  neon: ["@neondatabase/serverless", NEON_SDK],
  "neon-http": ["@neondatabase/serverless", NEON_SDK],
  vercel: ["@vercel/postgres", VERCEL_POSTGRES_SDK],
  pglite: ["@electric-sql/pglite", PGLITE_SDK],
  mysql: ["mysql2", MYSQL2_SDK],
  planetscale: ["@planetscale/database", PLANETSCALE_SDK],
  tidb: ["@tidbcloud/serverless", TIDBCLOUD_SDK],
};

/** The given StoryShelf packages, all at the version of this CLI. */
function ownPackages(names: readonly string[]): Record<string, string> {
  const version = __PKG_VERSION__ ?? "0.0.0";
  return Object.fromEntries(names.map((name) => [name, version]));
}

/** The app, the database package and, with observability, the packages it adds. */
function coreNames(answers: Answers): string[] {
  const names = ["@storyshelf/app", DB_PACKAGE[answers.database]];
  return wantsObservability(answers)
    ? [...names, "@storyshelf/core", "@storyshelf/observability"]
    : names;
}

/** The storage, runner, auth, git, design and notification packages the answers ask for. */
function featureNames(answers: Answers): string[] {
  const auth = AUTH_PACKAGE[answers.auth];
  return [
    ...(answers.storage === "local" ? [] : [STORAGE_PACKAGE[answers.storage]]),
    "@storyshelf/runner-playwright",
    ...(auth === null ? [] : [auth]),
    ...(wantsGit(answers) ? ["@storyshelf/notify-git"] : []),
    ...(wantsDesign(answers) ? ["@storyshelf/design-figma"] : []),
    ...(wantsNotifications(answers) ? ["@storyshelf/notify-chat", "@storyshelf/notify-email"] : []),
  ];
}

function buildDeps(answers: Answers): Record<string, string> {
  const sdk = DB_SDK[answers.database];
  return {
    "@hono/node-server": "^1.17.0",
    ...ownPackages(coreNames(answers)),
    ...(sdk ? { [sdk[0]]: sdk[1] } : {}),
    ...ownPackages(featureNames(answers)),
    ...(wantsNotifications(answers) ? { nodemailer: NODEMAILER_SDK } : {}),
  };
}

/** The Terraform npm scripts of the AWS, Azure and GCP targets. */
const INFRA_SCRIPTS: Record<string, string> = {
  "infra:init": "terraform -chdir=terraform init",
  "infra:plan": "terraform -chdir=terraform plan -out=tfplan",
  "infra:apply": "terraform -chdir=terraform apply tfplan",
  "infra:destroy": "terraform -chdir=terraform destroy",
  "infra:outputs": "terraform -chdir=terraform output -json",
};

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

/** The npm scripts: start, dev and typecheck, plus the Docker or Terraform ones of the deploy target. */
function scriptsFor(answers: Answers): Record<string, string> {
  const target = resolveDeployTarget(answers);
  return {
    start: `node ${SERVER_ENTRY}`,
    dev: `node --watch ${SERVER_ENTRY}`,
    typecheck: "tsc",
    ...(target === "docker" ? dockerScripts(answers) : {}),
    ...(target === "aws" || target === "azure" || target === "gcp" ? INFRA_SCRIPTS : {}),
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
    scripts: scriptsFor(answers),
    dependencies: buildDeps(answers),
    devDependencies: SCAFFOLD_DEV_DEPENDENCIES,
  };
  return JSON.stringify(pkg, null, 2);
}
