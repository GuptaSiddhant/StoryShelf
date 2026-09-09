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
import { generateComposeYaml, generateDockerfile, generateDockerignore } from "./docker.ts";
import { INFRA_PROMPTS, PROJECT_PROMPTS } from "./prompts.ts";

/**
 * Options for `storyshelf server init` — scaffolds a new StoryShelf server project.
 */
export interface ServerInitOptions {
  /** Output directory for the generated server (defaults to `storyshelf-server`). */
  dir?: string;
}

type DatabaseChoice = "sqlite" | "turso" | "postgres";
type StorageChoice = "local" | "s3";
type AuthChoice = "none" | "password" | "oauth";
type GitChoice = "none" | "github" | "gitlab";

interface Answers {
  name: string;
  dir: string;
  database: DatabaseChoice;
  storage: StorageChoice;
  auth: AuthChoice;
  git: GitChoice;
  docker: boolean;
}

const DB_PACKAGE: Record<DatabaseChoice, string> = {
  sqlite: "@storyshelf/db-sqlite",
  turso: "@storyshelf/db-turso",
  postgres: "@storyshelf/db-postgres",
};

const STORAGE_PACKAGE: Record<StorageChoice, string> = {
  local: "@storyshelf/storage-local",
  s3: "@storyshelf/storage-s3",
};

const AUTH_PACKAGE: Record<AuthChoice, string | null> = {
  none: null,
  password: "@storyshelf/auth-password",
  oauth: "@storyshelf/auth-oauth",
};

const GIT_PACKAGE: Record<GitChoice, string | null> = {
  none: null,
  github: "@storyshelf/git-github",
  gitlab: "@storyshelf/git-gitlab",
};

const DB_IMPORT: Record<DatabaseChoice, string> = {
  sqlite: `import { createSqliteDatabase } from "@storyshelf/db-sqlite";`,
  turso: `import { createTursoDatabase } from "@storyshelf/db-turso";`,
  postgres: `import { createPostgresDatabase } from "@storyshelf/db-postgres";`,
};

const STORAGE_IMPORT: Record<StorageChoice, string> = {
  local: `import { createLocalStorage } from "@storyshelf/storage-local";`,
  s3: `import { createS3Storage } from "@storyshelf/storage-s3";`,
};

const DB_INIT: Record<DatabaseChoice, string> = {
  sqlite: `createSqliteDatabase(\`\${dataDir}/shelf.db\`)`,
  turso: `createTursoDatabase({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN })`,
  postgres: `createPostgresDatabase({ url: process.env.DATABASE_URL! })`,
};

const STORAGE_INIT: Record<StorageChoice, string> = {
  local: `createLocalStorage(dataDir)`,
  s3: `createS3Storage({ bucket: process.env.S3_BUCKET!, region: process.env.AWS_REGION })`,
};

function buildImports(answers: Answers): string[] {
  const imports = [
    `import { serve } from "@hono/node-server";`,
    `import { createShelfRouter } from "@storyshelf/router";`,
    DB_IMPORT[answers.database],
    STORAGE_IMPORT[answers.storage],
  ];

  if (answers.auth !== "none") {
    imports.push(`import { createPasswordAuth } from "${AUTH_PACKAGE[answers.auth]}";`);
  }
  if (answers.git !== "none") {
    const host = answers.git === "github" ? "gitHubHost" : "gitLabHost";
    imports.push(`import { ${host} } from "${GIT_PACKAGE[answers.git]}";`);
  }
  imports.push(`import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";`);
  return imports;
}

function buildAdapterLines(answers: Answers): string[] {
  return [
    `// Adapters — swap these for your deployment`,
    `const database = ${DB_INIT[answers.database]};`,
    `const storage = ${STORAGE_INIT[answers.storage]};`,
    `const captureRunner = createPlaywrightCaptureRunner();`,
  ];
}

function buildRouterLines(answers: Answers): string[] {
  const lines = [
    `const app = createShelfRouter({`,
    `  database,`,
    `  storage,`,
    `  captureRunner,`,
  ];

  if (answers.auth !== "none") {
    lines.push(`  auth: createPasswordAuth({ password: process.env.AUTH_PASSWORD! }),`);
  }
  if (answers.git !== "none") {
    const host = answers.git === "github" ? "gitHubHost" : "gitLabHost";
    lines.push(`  gitHosts: [${host}],`);
  }

  lines.push(
    `  config: {`,
    `    secret: process.env.SECRET,`,
    `    scratchDir: dataDir,`,
    `  },`,
    `});`,
    ``,
    `await app.lifecycle.init();`,
    `const logger = app.lifecycle.logger;`,
  );

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
    `  logger.info({ port }, "StoryShelf server listening");`,
    `});`,
    ``,
    `const shutdown = async () => {`,
    `  await app.lifecycle.close();`,
    `  server.close();`,
    `};`,
    `process.on("SIGTERM", () => {`,
    `  shutdown().catch(() => {});`,
    `});`,
    `process.on("SIGINT", () => {`,
    `  shutdown().catch(() => {});`,
    `});`,
    ``,
  ].join("\n");
}

function buildDeps(answers: Answers): Record<string, string> {
  const deps: Record<string, string> = {
    "@hono/node-server": "^1.17.0",
    "@storyshelf/core": __PKG_VERSION__ ?? "0.0.0",
    "@storyshelf/router": __PKG_VERSION__ ?? "0.0.0",
    [DB_PACKAGE[answers.database]]: __PKG_VERSION__ ?? "0.0.0",
    "@storyshelf/runner-playwright": __PKG_VERSION__ ?? "0.0.0",
  };

  if (answers.storage !== "local") {
    deps[STORAGE_PACKAGE[answers.storage]] = __PKG_VERSION__ ?? "0.0.0";
  }
  if (answers.auth !== "none") {
    deps[AUTH_PACKAGE[answers.auth] ?? ""] = __PKG_VERSION__ ?? "0.0.0";
  }
  if (answers.git !== "none") {
    deps[GIT_PACKAGE[answers.git] ?? ""] = __PKG_VERSION__ ?? "0.0.0";
  }

  return deps;
}

function generatePackageJson(answers: Answers): string {
  const pkg = {
    name: answers.name,
    version: "0.1.0",
    type: "module",
    private: true,
    description: "StoryShelf self-hosted visual testing server.",
    scripts: {
      start: "node --experimental-transform-types server.ts",
      dev: "node --experimental-transform-types --watch server.ts",
    },
    dependencies: buildDeps(answers),
    devDependencies: {
      typescript: "^7.0.2",
    },
  };

  return JSON.stringify(pkg, null, 2);
}

async function writeFiles(outDir: string, answers: Answers): Promise<void> {
  const serverCode = generateServer(answers);
  await writeFile(join(outDir, "server.ts"), serverCode);
  printLine(`Created server.ts`);

  const pkgCode = generatePackageJson(answers);
  await writeFile(join(outDir, "package.json"), pkgCode);
  printLine(`Created package.json`);

  await writeDockerFiles(outDir, answers.docker, answers.database);
}

async function writeDockerFiles(
  outDir: string,
  docker: boolean,
  database: DatabaseChoice = "sqlite",
): Promise<void> {
  if (!docker) {
    return;
  }

  await writeFile(join(outDir, "Dockerfile"), generateDockerfile());
  await writeFile(join(outDir, ".dockerignore"), generateDockerignore());
  await writeFile(join(outDir, "compose.yaml"), generateComposeYaml(database));
  printLine(`Created Dockerfile, .dockerignore, compose.yaml`);
}

function printNextSteps(answers: Answers, runner: PackageRunner): void {
  printLine(`\nScaffolded ${answers.name} in ${resolve(answers.dir)}`);
  printLine(`\nNext steps:`);
  printLine(`  cd ${answers.dir}`);

  if (answers.docker) {
    printLine(`  docker compose up`);
  } else {
    printLine(`  ${installCommand(runner)}`);
    printLine(`  ${startCommand(runner)}`);
  }
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
  const responses = await prompts([...PROJECT_PROMPTS, ...INFRA_PROMPTS]);

  if (!responses["name"] || !responses["dir"]) {
    printError("Cancelled.");
    return;
  }

  const answers = responses as unknown as Answers;
  const outDir = resolve(answers.dir);
  await mkdir(outDir, { recursive: true });

  await writeFiles(outDir, answers);
  printNextSteps(answers, await detectPackageRunner(process.cwd()));
}
