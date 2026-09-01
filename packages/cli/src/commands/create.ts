import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import prompts from "prompts";
import { printError, printLine } from "../output.ts";

/** Options for the `create` command. */
export interface CreateOptions {
  /** Output directory. */
  dir?: string;
}

type DatabaseChoice = "sqlite" | "turso";
type StorageChoice = "local" | "s3";
type AuthChoice = "none" | "password" | "oauth";
type GitChoice = "none" | "github";

interface Answers {
  name: string;
  dir: string;
  database: DatabaseChoice;
  storage: StorageChoice;
  auth: AuthChoice;
  git: GitChoice;
}

const DB_PACKAGE: Record<DatabaseChoice, string> = {
  sqlite: "@storyshelf/db-sqlite",
  turso: "@storyshelf/db-turso",
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
};

const DB_IMPORT: Record<DatabaseChoice, string> = {
  sqlite: `import { createSqliteDatabase } from "@storyshelf/db-sqlite";`,
  turso: `import { createTursoDatabase } from "@storyshelf/db-turso";`,
};

const STORAGE_IMPORT: Record<StorageChoice, string> = {
  local: `import { createLocalStorage } from "@storyshelf/storage-local";`,
  s3: `import { createS3Storage } from "@storyshelf/storage-s3";`,
};

const DB_INIT: Record<DatabaseChoice, string> = {
  sqlite: `createSqliteDatabase(\`\${dataDir}/shelf.db\`)`,
  turso: `createTursoDatabase({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN })`,
};

const STORAGE_INIT: Record<StorageChoice, string> = {
  local: `createLocalStorage(dataDir)`,
  s3: `createS3Storage({ bucket: process.env.S3_BUCKET!, region: process.env.AWS_REGION })`,
};

function generateServer(answers: Answers): string {
  const imports = [
    `import { serve } from "@hono/node-server";`,
    `import { createShelfLogger, createShelfRouter } from "@storyshelf/core";`,
    DB_IMPORT[answers.database],
    STORAGE_IMPORT[answers.storage],
  ];

  if (answers.auth !== "none") {
    imports.push(`import { createPasswordAuth } from "${AUTH_PACKAGE[answers.auth]}";`);
  }
  if (answers.git !== "none") {
    imports.push(`import { githubProvider } from "${GIT_PACKAGE[answers.git]}";`);
  }
  imports.push(`import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";`);

  const adapterLines = [
    `// Adapters — swap these for your deployment`,
    `const database = ${DB_INIT[answers.database]};`,
    `const storage = ${STORAGE_INIT[answers.storage]};`,
    `const captureRunner = createPlaywrightCaptureRunner();`,
    `const logger = createShelfLogger({ level: process.env.LOG_LEVEL });`,
  ];

  const routerLines = [
    `const app = createShelfRouter({`,
    `  database,`,
    `  storage,`,
    `  captureRunner,`,
    `  logger,`,
  ];

  if (answers.auth !== "none") {
    routerLines.push(`  auth: createPasswordAuth({ password: process.env.AUTH_PASSWORD! }),`);
  }
  if (answers.git !== "none") {
    routerLines.push(`  gitProviders: [githubProvider],`);
  }

  routerLines.push(
    `  config: {`,
    `    secret: process.env.SECRET,`,
    `    scratchDir: dataDir,`,
    `  },`,
    `});`,
  );

  const serverLines = [
    `serve({ fetch: app.fetch, port }, () => {`,
    `  logger.info({ port }, "StoryShelf server listening");`,
    `});`,
  ];

  return [
    ...imports,
    ``,
    `const dataDir = process.env.DATA_DIR || "./data";`,
    `const port = Number(process.env.PORT) || 3000;`,
    ``,
    ...adapterLines,
    ``,
    ...routerLines,
    ``,
    ...serverLines,
    ``,
  ].join("\n");
}

function generatePackageJson(answers: Answers): string {
  const deps: Record<string, string> = {
    "@hono/node-server": "^1.17.0",
    "@storyshelf/core": "workspace:*",
    [DB_PACKAGE[answers.database]]: "workspace:*",
    "@storyshelf/runner-playwright": "workspace:*",
  };

  if (answers.storage !== "local") {
    deps[STORAGE_PACKAGE[answers.storage]] = "workspace:*";
  }
  if (answers.auth !== "none") {
    deps[AUTH_PACKAGE[answers.auth] ?? ""] = "workspace:*";
  }
  if (answers.git !== "none") {
    deps[GIT_PACKAGE[answers.git] ?? ""] = "workspace:*";
  }

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
    dependencies: deps,
    devDependencies: {
      typescript: "^7.0.2",
    },
  };

  return JSON.stringify(pkg, null, 2);
}

/**
 * Scaffold a new StoryShelf server project.
 *
 * @param _options - Create command options.
 */
export async function runCreate(_options: CreateOptions): Promise<void> {
  const responses = await prompts([
    {
      type: "text",
      name: "name",
      message: "Project name?",
      initial: "my-storyshelf",
    },
    {
      type: "text",
      name: "dir",
      message: "Directory?",
      initial: (prev: string): string => `./${prev}`,
    },
    {
      type: "select",
      name: "database",
      message: "Which database?",
      choices: [
        { title: "SQLite (local)", value: "sqlite" },
        { title: "Turso (serverless)", value: "turso" },
      ],
    },
    {
      type: "select",
      name: "storage",
      message: "Which storage?",
      choices: [
        { title: "Local filesystem", value: "local" },
        { title: "S3-compatible", value: "s3" },
      ],
    },
    {
      type: "select",
      name: "auth",
      message: "Which auth?",
      choices: [
        { title: "None", value: "none" },
        { title: "Shared password", value: "password" },
        { title: "OAuth/OIDC", value: "oauth" },
      ],
    },
    {
      type: "select",
      name: "git",
      message: "Which git provider?",
      choices: [
        { title: "None", value: "none" },
        { title: "GitHub", value: "github" },
      ],
    },
  ]);

  if (!responses.name || !responses.dir) {
    printError("Cancelled.");
    return;
  }

  const answers = responses as unknown as Answers;
  const outDir = resolve(answers.dir);
  await mkdir(outDir, { recursive: true });

  // --- Generate server.ts ---
  const serverCode = generateServer(answers);
  await writeFile(join(outDir, "server.ts"), serverCode);
  printLine(`Created server.ts`);

  // --- Generate package.json ---
  const pkgCode = generatePackageJson(answers);
  await writeFile(join(outDir, "package.json"), pkgCode);
  printLine(`Created package.json`);

  printLine(`\nScaffolded ${answers.name} in ${outDir}`);
  printLine(`\nNext steps:`);
  printLine(`  cd ${answers.dir}`);
  printLine(`  npm install`);
  printLine(`  npm start`);
}
