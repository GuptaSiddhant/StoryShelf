declare const __PKG_VERSION__: string;

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import prompts from "prompts";
import {
  detectPackageRunner,
  installCommand,
  startCommand,
  type PackageRunner,
} from "../../config.ts";
import { printError, printLine } from "../../output.ts";
import { detectInstalledAdapters } from "../shared/detect-adapters.ts";
import {
  generateTsconfig,
  SCAFFOLD_DEV_DEPENDENCIES,
  SERVER_ENTRY,
  writeScaffoldFile,
} from "../shared/scaffold.ts";
import { generateComposeYaml, generateDockerfile, generateDockerignore } from "./docker.ts";
import {
  ADVANCED_ADAPTERS_PROMPT,
  DEPLOY_TARGET_PROMPT,
  PROJECT_PROMPTS,
  AWS_INFRA_PROMPTS,
  AZURE_INFRA_PROMPTS,
  GCP_INFRA_PROMPTS,
  localInfraPrompts,
} from "./prompts.ts";
import { generateAwsTerraformFiles } from "./terraform-aws.ts";
import { generateAzureTerraformFiles } from "./terraform-azure.ts";
import { generateGcpTerraformFiles } from "./terraform-gcp.ts";

/**
 * Options for `storyshelf server init` — scaffolds a new StoryShelf server project.
 */
export interface ServerInitOptions {
  /** Output directory for the generated server (defaults to `storyshelf-server`). */
  dir?: string;
}

type DatabaseChoice =
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
type StorageChoice = "local" | "s3" | "azure" | "gcs";
type AuthChoice = "none" | "password" | "oauth";
type GitChoice = "none" | "git";
type DeployTarget = "local" | "docker" | "aws" | "azure" | "gcp";

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

interface Answers {
  name: string;
  dir: string;
  database: DatabaseChoice;
  storage: StorageChoice;
  auth: AuthChoice;
  git: GitChoice;
  docker: boolean;
  /** Email + chat notification wiring. Absent in older mocked answers. */
  notifications?: boolean;
  /** Figma design links via `@storyshelf/design-figma` (opt-in). Absent means off. */
  design?: boolean;
  /** OpenTelemetry wiring (opt-in). Absent means off. */
  observability?: boolean;
  /** Deploy target. Absent in older mocked answers — derived from `docker`. */
  deployTarget?: DeployTarget;
  /** Curated-path opt-in: show the full adapter matrix on local/docker. */
  advancedAdapters?: boolean;
  /** AWS-only follow-ups (asked when deployTarget is `aws`). */
  awsRegion?: string;
  dbEngine?: "rds" | "dsql";
  domainName?: string;
  samlMetadataUrl?: string;
  /** Azure-only follow-ups (asked when deployTarget is `azure`). */
  azureLocation?: string;
  entraTenantId?: string;
  /** GCP-only follow-ups (asked when deployTarget is `gcp`). */
  gcpProjectId?: string;
  gcpLocation?: string;
  identityTenant?: string;
}

/** Normalize the deploy target, preserving pre-target answers. */
function resolveDeployTarget(answers: Answers): DeployTarget {
  return answers.deployTarget ?? (answers.docker ? "docker" : "local");
}

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

const DB_IMPORT: Record<DatabaseChoice, string> = {
  sqlite: `import { createSqliteDatabase } from "@storyshelf/db-sqlite";`,
  turso: `import { createTursoDatabase } from "@storyshelf/db-sqlite/turso";`,
  "better-sqlite3": `import { createBetterSqlite3Database } from "@storyshelf/db-sqlite/better-sqlite3";`,
  "bun-sqlite": `import { createBunSqliteDatabase } from "@storyshelf/db-sqlite/bun-sqlite";`,
  d1: `import { createD1Database } from "@storyshelf/db-sqlite/d1";`,
  postgres: `import { createPostgresDatabase } from "@storyshelf/db-postgres";`,
  pg: `import { createPgDatabase } from "@storyshelf/db-postgres/pg";`,
  neon: `import { createNeonDatabase } from "@storyshelf/db-postgres/neon";`,
  "neon-http": `import { createNeonHttpDatabase } from "@storyshelf/db-postgres/neon-http";`,
  vercel: `import { createVercelDatabase } from "@storyshelf/db-postgres/vercel";`,
  pglite: `import { createPgliteDatabase } from "@storyshelf/db-postgres/pglite";`,
  mysql: `import { createMysqlDatabase } from "@storyshelf/db-mysql";`,
  planetscale: `import { createPlanetscaleDatabase } from "@storyshelf/db-mysql/planetscale";`,
  tidb: `import { createTidbDatabase } from "@storyshelf/db-mysql/tidb";`,
};

const STORAGE_IMPORT: Record<StorageChoice, string> = {
  local: `import { createLocalStorage } from "@storyshelf/storage-local";`,
  s3: `import { createS3Storage } from "@storyshelf/storage-s3";`,
  azure: `import { createAzureStorage } from "@storyshelf/storage-azure";`,
  gcs: `import { createGcsStorage } from "@storyshelf/storage-gcs";`,
};

const DB_INIT: Record<DatabaseChoice, string> = {
  sqlite: `createSqliteDatabase(\`\${dataDir}/shelf.db\`)`,
  turso: `createTursoDatabase({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN })`,
  "better-sqlite3": `createBetterSqlite3Database({ path: \`\${dataDir}/shelf.db\` })`,
  "bun-sqlite": `createBunSqliteDatabase({ path: \`\${dataDir}/shelf.db\` })`,
  d1: `createD1Database({ client: getD1Binding() })`,
  postgres: `createPostgresDatabase({ url: process.env.DATABASE_URL! })`,
  pg: `createPgDatabase({ url: process.env.DATABASE_URL! })`,
  neon: `createNeonDatabase({ url: process.env.DATABASE_URL! })`,
  "neon-http": `createNeonHttpDatabase({ url: process.env.DATABASE_URL! })`,
  vercel: `createVercelDatabase()`,
  pglite: `createPgliteDatabase()`,
  mysql: `createMysqlDatabase({ url: process.env.DATABASE_URL! })`,
  planetscale: `createPlanetscaleDatabase({ url: process.env.DATABASE_URL! })`,
  tidb: `createTidbDatabase({ url: process.env.DATABASE_URL! })`,
};

/** Extra scaffolding before `const database = ...` (D1 binding stub). */
function dbPrelude(database: DatabaseChoice): string[] {
  if (database !== "d1") {
    return [];
  }
  return [
    `// TODO: provide your D1 binding (Cloudflare Workers: env.DB).`,
    `function getD1Binding(): never {`,
    `  throw new Error("Provide your D1 database binding (env.DB).");`,
    `}`,
  ];
}

const STORAGE_INIT: Record<StorageChoice, string> = {
  local: `createLocalStorage(dataDir)`,
  s3: `createS3Storage({ bucket: process.env.S3_BUCKET!, region: process.env.AWS_REGION })`,
  azure: `createAzureStorage({ container: "storybook", connectionString: process.env.AZURE_STORAGE_CONNECTION! })`,
  gcs: `createGcsStorage({ bucket: process.env.GCS_BUCKET! })`,
};

/** Whether the generated server wires the git providers (commit statuses on GitHub/GitLab). */
function wantsGit(answers: Answers): boolean {
  return answers.git !== "none";
}

/** The provider lists the generated `notifications.notifiers` spreads, in wiring order. */
function notifierSpreads(answers: Answers): string[] {
  return [
    ...(wantsNotifications(answers) ? ["...chatNotifiers", "...emailNotifiers"] : []),
    ...(wantsGit(answers) ? ["...gitNotifiers"] : []),
  ];
}

/** Whether the generated server wires notification providers (opt-in). */
function wantsNotifications(answers: Answers): boolean {
  return answers.notifications ?? false;
}

/** Whether the generated server wires the Figma design provider (opt-in). */
function wantsDesign(answers: Answers): boolean {
  return answers.design ?? false;
}

/** Whether the generated server wires OpenTelemetry (opt-in). */
function wantsObservability(answers: Answers): boolean {
  return answers.observability ?? false;
}

const NAMED_IMPORT_RE = /^import \{ (?<names>[^}]+) \} from "(?<from>[^"]+)";$/u;

/** Merge named imports that share a module into one line (keeps first-seen order). */
function mergeImports(lines: string[]): string[] {
  const merged = new Map<string, string[]>();
  for (const line of lines) {
    const match = NAMED_IMPORT_RE.exec(line);
    const key = match?.groups?.["from"] ?? line;
    const names = match?.groups?.["names"]?.split(", ") ?? [];
    merged.set(key, [...(merged.get(key) ?? []), ...names]);
  }
  return [...merged].map(([from, names]) =>
    names.length > 0 ? `import { ${names.join(", ")} } from "${from}";` : from,
  );
}

function buildImports(answers: Answers): string[] {
  const imports = [
    `import { serve } from "@hono/node-server";`,
    `import { createShelfApp } from "@storyshelf/app";`,
    DB_IMPORT[answers.database],
    STORAGE_IMPORT[answers.storage],
    `import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";`,
  ];
  if (wantsObservability(answers)) {
    imports.push(
      `import { createShelfLogger } from "@storyshelf/core/logger";`,
      `import { otelLogMixin } from "@storyshelf/observability";`,
      `import { initObservabilityFromEnv } from "@storyshelf/observability/node";`,
    );
  }

  if (answers.auth === "password") {
    imports.push(`import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";`);
  }
  if (answers.auth === "oauth") {
    imports.push(`import { createShelfAuth } from "@storyshelf/auth";`);
    if (resolveDeployTarget(answers) === "aws") {
      imports.push(`import { cognitoPreset } from "@storyshelf/auth";`);
    } else {
      imports.push(`import { keycloakPreset } from "@storyshelf/auth";`);
    }
  }
  if (wantsGit(answers)) {
    imports.push(`import { gitNotifiers } from "@storyshelf/notify-git";`);
  }
  if (wantsDesign(answers)) {
    imports.push(
      `import { createFigmaDesign, figmaOAuthFromEnv } from "@storyshelf/design-figma";`,
    );
  }
  if (wantsNotifications(answers)) {
    imports.push(
      `import { chatNotifiers } from "@storyshelf/notify-chat";`,
      `import { createEmailNotifier, smtpPresetFromEnv } from "@storyshelf/notify-email";`,
    );
    if (answers.auth !== "none") {
      imports.push(`import { createAuthSystemHook } from "@storyshelf/app";`);
    }
  }
  return mergeImports(imports);
}

function buildAdapterLines(answers: Answers): string[] {
  const lines = [
    ...dbPrelude(answers.database),
    `const database = ${DB_INIT[answers.database]};`,
    `const storage = ${STORAGE_INIT[answers.storage]};`,
    `const captureRunner = createPlaywrightCaptureRunner();`,
  ];
  if (wantsNotifications(answers)) {
    lines.push(
      `// SMTP sender from SMTP_* env (undefined keeps invites out-of-band).`,
      `const emailSender = smtpPresetFromEnv(process.env);`,
      `const emailNotifiers = emailSender`,
      `  ? [createEmailNotifier(emailSender, { from: process.env.SMTP_FROM })]`,
      `  : [];`,
    );
  }
  return lines;
}

function buildRouterLines(answers: Answers): string[] {
  const lines = wantsObservability(answers)
    ? [
        `// Noop unless OTEL_EXPORTER_OTLP_ENDPOINT is set.`,
        `const observability = await initObservabilityFromEnv();`,
        `const shelfLogger = createShelfLogger({ mixin: otelLogMixin });`,
        ``,
      ]
    : [];
  lines.push(
    `const app = createShelfApp({`,
    `  database,`,
    `  storage,`,
    `  testing: { runner: captureRunner },`,
  );

  const notifiers = notifierSpreads(answers);
  if (notifiers.length > 0) {
    lines.push(`  notifications: { notifiers: [${notifiers.join(", ")}] },`);
  }

  if (answers.auth === "password") {
    lines.push(
      `  auth: createShelfAuth({`,
      `    db: database,`,
      `    secret: process.env.SECRET!,`,
      `    baseURL: process.env.PUBLIC_BASE_URL!,`,
      ...(wantsNotifications(answers)
        ? [
            `    emailSender,`,
            `    fromEmail: process.env.SMTP_FROM,`,
            `    onAuthSystemEvent: createAuthSystemHook(),`,
          ]
        : []),
      `  }).adapter,`,
    );
  }
  if (answers.auth === "oauth" && resolveDeployTarget(answers) === "aws") {
    lines.push(
      `  auth: createShelfAuth({`,
      `    db: database,`,
      `    secret: process.env.SECRET!,`,
      `    baseURL: process.env.PUBLIC_BASE_URL!,`,
      ...(wantsNotifications(answers)
        ? [
            `    emailSender,`,
            `    fromEmail: process.env.SMTP_FROM,`,
            `    onAuthSystemEvent: createAuthSystemHook(),`,
          ]
        : []),
      `    social: [`,
      `      cognitoPreset({`,
      `        domain: process.env.COGNITO_DOMAIN!,`,
      `        region: process.env.COGNITO_REGION!,`,
      `        userPoolId: process.env.COGNITO_USER_POOL_ID!,`,
      `        clientId: process.env.OIDC_CLIENT_ID!,`,
      `        clientSecret: process.env.OIDC_CLIENT_SECRET,`,
      `      }),`,
      `    ],`,
      `  }).adapter,`,
    );
  }
  if (answers.auth === "oauth" && resolveDeployTarget(answers) !== "aws") {
    lines.push(
      `  auth: createShelfAuth({`,
      `    db: database,`,
      `    secret: process.env.SECRET!,`,
      `    baseURL: process.env.PUBLIC_BASE_URL!,`,
      ...(wantsNotifications(answers)
        ? [
            `    emailSender,`,
            `    fromEmail: process.env.SMTP_FROM,`,
            `    onAuthSystemEvent: createAuthSystemHook(),`,
          ]
        : []),
      `    oauth: [`,
      `      keycloakPreset(process.env.OIDC_ISSUER!, {`,
      `        clientId: process.env.OIDC_CLIENT_ID!,`,
      `        clientSecret: process.env.OIDC_CLIENT_SECRET,`,
      `      }),`,
      `    ],`,
      `  }).adapter,`,
    );
  }
  if (wantsDesign(answers)) {
    lines.push(`  design: [createFigmaDesign({ oauth: figmaOAuthFromEnv() })],`);
  }

  if (wantsObservability(answers)) {
    lines.push(`  logger: shelfLogger,`, `  observability,`);
  }
  lines.push(
    `  config: {`,
    `    secret: process.env.SECRET,`,
    `    previousSecret: process.env.SECRET_PREVIOUS || undefined,`,
    `    migrateCredentialsOnBoot: process.env.SECRET_MIGRATE === "true",`,
    `    scratchDir: dataDir,`,
    `  },`,
    `});`,
    ``,
    `await app.lifecycle.setup();`,
  );

  if (answers.auth === "password") {
    lines.push(
      ``,
      `// Provision the env-driven local admin (AUTH_PASSWORD, at least 12 chars).`,
      `await ensurePasswordAdmin(database, {`,
      `  email: process.env.AUTH_EMAIL ?? "admin@example.com",`,
      `  password: process.env.AUTH_PASSWORD!,`,
      `});`,
    );
  }

  return lines;
}

function generateServer(answers: Answers): string {
  return [
    ...buildImports(answers),
    ``,
    `const dataDir = process.env.DATA_DIR || "./data";`,
    `const port = Number(process.env.PORT) || 3000;`,
    ``,
    ...buildAdapterLines(answers),
    ``,
    ...buildRouterLines(answers),
    ``,
    `const server = serve({ fetch: app.fetch, port }, () => {`,
    `  app.lifecycle.logger.info({ port }, "StoryShelf server listening");`,
    `});`,
    ``,
    `for (const signal of ["SIGINT", "SIGTERM"] as const) {`,
    `  process.once(signal, () => {`,
    `    app.lifecycle.teardown().finally(() => server.close());`,
    `  });`,
    `}`,
    ``,
  ].join("\n");
}

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

/** Whether the Docker setup needs compose: more than one service (Postgres). */
function needsCompose(answers: Answers): boolean {
  return answers.database === "postgres";
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

function generatePackageJson(answers: Answers): string {
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

async function writeFiles(outDir: string, answers: Answers): Promise<void> {
  await writeScaffoldFile(outDir, SERVER_ENTRY, generateServer(answers));
  printLine(`Created ${SERVER_ENTRY}`);

  await writeFile(join(outDir, "package.json"), generatePackageJson(answers));
  await writeFile(join(outDir, "tsconfig.json"), generateTsconfig());
  printLine(`Created package.json, tsconfig.json`);

  if (resolveDeployTarget(answers) === "aws") {
    await writeTerraformFiles(outDir, answers);
  }

  if (resolveDeployTarget(answers) === "azure") {
    await writeAzureTerraformFiles(outDir, answers);
  }

  if (resolveDeployTarget(answers) === "gcp") {
    await writeGcpTerraformFiles(outDir, answers);
  }

  await writeDockerFiles(outDir, answers);
}

/** Write the GCP Terraform reference stack (`terraform/*.tf` + README). */
async function writeGcpTerraformFiles(outDir: string, answers: Answers): Promise<void> {
  const files = generateGcpTerraformFiles({
    project: answers.name,
    gcpProjectId: answers.gcpProjectId ?? "",
    location: answers.gcpLocation ?? "us-central1",
    ...(answers.domainName ? { domainName: answers.domainName } : {}),
    ...(answers.identityTenant ? { identityTenant: answers.identityTenant } : {}),
  });
  await mkdir(join(outDir, "terraform"), { recursive: true });
  for (const [relative, contents] of Object.entries(files)) {
    await writeFile(join(outDir, relative), contents);
  }
  printLine(`Created terraform/ (${Object.keys(files).length} files)`);
}

/** Write the Azure Terraform reference stack (`terraform/*.tf` + README). */
async function writeAzureTerraformFiles(outDir: string, answers: Answers): Promise<void> {
  const files = generateAzureTerraformFiles({
    project: answers.name,
    location: answers.azureLocation ?? "eastus",
    ...(answers.domainName ? { domainName: answers.domainName } : {}),
    ...(answers.entraTenantId ? { entraTenantId: answers.entraTenantId } : {}),
  });
  await mkdir(join(outDir, "terraform"), { recursive: true });
  for (const [relative, contents] of Object.entries(files)) {
    await writeFile(join(outDir, relative), contents);
  }
  printLine(`Created terraform/ (${Object.keys(files).length} files)`);
}

/** Write the AWS Terraform reference stack (`terraform/*.tf` + README). */
async function writeTerraformFiles(outDir: string, answers: Answers): Promise<void> {
  const files = generateAwsTerraformFiles({
    project: answers.name,
    region: answers.awsRegion ?? "us-east-1",
    dbEngine: answers.dbEngine ?? "rds",
    ...(answers.domainName ? { domainName: answers.domainName } : {}),
    ...(answers.samlMetadataUrl ? { samlMetadataUrl: answers.samlMetadataUrl } : {}),
  });
  await mkdir(join(outDir, "terraform"), { recursive: true });
  for (const [relative, contents] of Object.entries(files)) {
    await writeFile(join(outDir, relative), contents);
  }
  printLine(`Created terraform/ (${Object.keys(files).length} files)`);
}

async function writeDockerFiles(outDir: string, answers: Answers): Promise<void> {
  if (!answers.docker) {
    return;
  }
  const created = ["Dockerfile", ".dockerignore"];
  await writeFile(join(outDir, "Dockerfile"), generateDockerfile());
  await writeFile(join(outDir, ".dockerignore"), generateDockerignore());
  if (needsCompose(answers)) {
    await writeFile(join(outDir, "compose.yaml"), generateComposeYaml(answers.database));
    created.push("compose.yaml");
  }
  printLine(`Created ${created.join(", ")}`);
}

function printNextSteps(answers: Answers, runner: PackageRunner): void {
  printLine(`\nScaffolded ${answers.name} in ${resolve(answers.dir)}`);
  printLine(`\nNext steps:`);
  printLine(`  cd ${answers.dir}`);

  const target = resolveDeployTarget(answers);
  if (target === "aws") {
    printLine(`  terraform -chdir=terraform init`);
    printLine(`  terraform -chdir=terraform plan -out=tfplan   # review before applying`);
    printLine(`  terraform -chdir=terraform apply tfplan       # or: npm run infra:apply`);
    printLine(`  # wire outputs into env (terraform output -json / npm run infra:outputs):`);
    printLine(`  #   S3_BUCKET / AWS_REGION, DATABASE_URL, COGNITO_* credentials`);
    printLine(`  npm install`);
    printLine(`  npm start`);
    return;
  }

  if (target === "azure") {
    printLine(`  az login`);
    printLine(`  terraform -chdir=terraform init`);
    printLine(`  terraform -chdir=terraform plan -out=tfplan   # review before applying`);
    printLine(`  terraform -chdir=terraform apply tfplan       # or: npm run infra:apply`);
    printLine(`  # wire outputs into env (terraform output -json / npm run infra:outputs):`);
    printLine(`  #   AZURE_STORAGE_CONNECTION, DATABASE_URL, OIDC_* credentials`);
    printLine(`  npm install`);
    printLine(`  npm start`);
    return;
  }

  if (target === "gcp") {
    printLine(`  gcloud auth login`);
    printLine(`  terraform -chdir=terraform init`);
    printLine(`  terraform -chdir=terraform plan -out=tfplan   # review before applying`);
    printLine(`  terraform -chdir=terraform apply tfplan       # or: npm run infra:apply`);
    printLine(`  # wire outputs into env (terraform output -json / npm run infra:outputs):`);
    printLine(`  #   GCS_BUCKET + GOOGLE_CLOUD_PROJECT, DATABASE_URL, OIDC_* credentials`);
    printLine(`  npm install`);
    printLine(`  npm start`);
    return;
  }

  if (target === "docker") {
    if (needsCompose(answers)) {
      printLine(`  npm run docker:up      # builds + starts the app`);
      printLine(`  npm run docker:logs    # follow logs`);
      printLine(`  npm run docker:down    # tear down`);
    } else {
      printLine(`  npm run docker:build   # builds the image`);
      printLine(`  npm run docker:run     # runs it on :3000 (data in a named volume)`);
    }
    return;
  }

  printLine(`  ${installCommand(runner)}`);
  printLine(`  ${startCommand(runner)}`);
}

function promptInitial(choices: { value: string }[], value?: string): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const idx = choices.findIndex((c) => c.value === value);
  if (idx === -1) return undefined;
  return idx;
}

/**
 * Scaffold a new StoryShelf server project via interactive prompts.
 *
 * Asks for project name, database, storage, auth, and git provider choices,
 * then generates `server.ts`, `package.json`, and optional Docker files in
 * the chosen directory.
 *
 * @param _options - Reserved for future CLI flags; currently prompts for all choices interactively
 */
export async function runServerInit(_options: ServerInitOptions): Promise<void> {
  // Try to autofill from existing package.json (re-init)
  const cwdPkg = detectInstalledAdapters(process.cwd());

  // Phase 1 (curated path): project + deploy target first. Legacy single-call
  // mocks return the full answer object here — merge progressively so those
  // tests keep passing while interactive users get filtered phase-2 prompts.
  const phase1 =
    ((await prompts([...PROJECT_PROMPTS, DEPLOY_TARGET_PROMPT])) as Record<string, unknown>) ?? {};

  if (!phase1["name"] || !phase1["dir"]) {
    printError("Cancelled.");
    return;
  }

  const answers = { ...phase1 } as unknown as Answers;
  const target = resolveDeployTarget(answers);

  // Local/docker path: advanced toggle, then curated (4 DBs) or full matrix.
  if (target === "local" || target === "docker") {
    const advPhase =
      ((await prompts(ADVANCED_ADAPTERS_PROMPT as never)) as Record<string, unknown>) ?? {};
    const advanced =
      (answers.advancedAdapters as boolean | undefined) ??
      (advPhase["advancedAdapters"] as boolean | undefined) ??
      false;
    answers.advancedAdapters = advanced;

    const localPrompts = localInfraPrompts(advanced).map((prompt) => {
      if (prompt.type !== "select") {
        return prompt;
      }
      // Prefer an already-provided (legacy mock) or detected value as initial.
      const legacy = answers[prompt.name as keyof Answers] as string | undefined;
      const detected = cwdPkg[prompt.name as keyof typeof cwdPkg] as string | undefined;
      const initial = promptInitial(prompt.choices, legacy ?? detected);
      if (initial !== undefined) {
        return { ...prompt, initial };
      }
      return prompt;
    });

    const phase2 = ((await prompts(localPrompts as never)) as Record<string, unknown>) ?? {};
    Object.assign(answers, phase2);
    answers.advancedAdapters = advanced;
    answers.deployTarget ??= target;
  } else {
    // Cloud targets pin the enterprise reference stack — no adapter menu.
    // Merge any legacy single-call mock values first, then force the stack.
    const legacyInfra = { ...phase1 };
    Object.assign(answers, legacyInfra);
  }
  // AWS target: fixed enterprise reference stack (Postgres + S3). Dockerfiles still generate for ECR image builds.
  if (resolveDeployTarget(answers) === "aws") {
    answers.database = "postgres";
    answers.storage = "s3";
    answers.docker = true;
    const awsAnswers = ((await prompts(AWS_INFRA_PROMPTS)) as Record<string, unknown>) ?? {};
    answers.awsRegion = (awsAnswers["awsRegion"] as string | undefined) ?? "us-east-1";
    answers.dbEngine = (awsAnswers["dbEngine"] as "rds" | "dsql" | undefined) ?? "rds";
    answers.domainName = (awsAnswers["domainName"] as string | undefined) ?? undefined;
    answers.samlMetadataUrl = (awsAnswers["samlMetadataUrl"] as string | undefined) ?? undefined;
  }

  // Azure target: fixed enterprise reference stack (Postgres + Blob). Dockerfiles still
  // generate for ACR image builds.
  if (resolveDeployTarget(answers) === "azure") {
    answers.database = "postgres";
    answers.storage = "azure";
    answers.docker = true;
    const azureAnswers = ((await prompts(AZURE_INFRA_PROMPTS)) as Record<string, unknown>) ?? {};
    answers.azureLocation = (azureAnswers["azureLocation"] as string | undefined) ?? "eastus";
    answers.domainName = (azureAnswers["domainName"] as string | undefined) ?? undefined;
    answers.entraTenantId = (azureAnswers["entraTenantId"] as string | undefined) ?? undefined;
  }

  // GCP target: fixed enterprise reference stack (Postgres + GCS). Dockerfiles still generate for
  // Artifact Registry image builds.
  if (resolveDeployTarget(answers) === "gcp") {
    answers.database = "postgres";
    answers.storage = "gcs";
    answers.docker = true;
    const gcpAnswers = ((await prompts(GCP_INFRA_PROMPTS)) as Record<string, unknown>) ?? {};
    answers.gcpProjectId = (gcpAnswers["gcpProjectId"] as string | undefined) ?? undefined;
    answers.gcpLocation = (gcpAnswers["gcpLocation"] as string | undefined) ?? "us-central1";
    answers.domainName = (gcpAnswers["domainName"] as string | undefined) ?? undefined;
    answers.identityTenant = (gcpAnswers["identityTenant"] as string | undefined) ?? undefined;
  }

  const outDir = resolve(answers.dir);
  await mkdir(outDir, { recursive: true });

  await writeFiles(outDir, answers);
  printNextSteps(answers, await detectPackageRunner(process.cwd()));
}
