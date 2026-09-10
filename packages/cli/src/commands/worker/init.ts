declare const __PKG_VERSION__: string;

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import prompts from "prompts";
import { detectPackageRunner, installCommand, type PackageRunner } from "../../config.ts";
import { printError, printLine } from "../../output.ts";
import { generateDockerignore, generateWorkerDockerfile } from "../server/docker.ts";
import { PROJECT_PROMPTS, WORKER_INFRA_PROMPTS } from "../server/prompts.ts";
import { detectInstalledAdapters } from "../shared/detect-adapters.ts";

export interface WorkerInitOptions {
  dir?: string;
}

type DatabaseChoice = "sqlite" | "turso" | "postgres";
type StorageChoice = "local" | "s3";
type QueueChoice = "sqs" | "memory";

interface Answers {
  name: string;
  dir: string;
  database: DatabaseChoice;
  storage: StorageChoice;
  queue: QueueChoice;
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

const QUEUE_PACKAGE: Record<QueueChoice, string | null> = {
  sqs: "@storyshelf/queue-sqs",
  memory: null,
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

function generateWorker(answers: Answers): string {
  const queueLine =
    answers.queue === "sqs"
      ? `import { createSqsCaptureQueue } from "@storyshelf/queue-sqs";`
      : `// In-memory queue is server-side only; worker uses a remote queue.`;
  const queueInit =
    answers.queue === "sqs"
      ? `const queue = createSqsCaptureQueue({ queueUrl: process.env.QUEUE_URL! });`
      : `const queue = null as unknown as never; // replace with a remote queue`;

  return [
    queueLine,
    `import { createCaptureWorker } from "@storyshelf/worker";`,
    `import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";`,
    DB_IMPORT[answers.database],
    STORAGE_IMPORT[answers.storage],
    ``,
    `const dataDir = process.env.DATA_DIR || "./data";`,
    `const database = ${DB_INIT[answers.database]};`,
    `const storage = ${STORAGE_INIT[answers.storage]};`,
    queueInit,
    `const runner = createPlaywrightCaptureRunner();`,
    ``,
    `const worker = createCaptureWorker({`,
    `  queue,`,
    `  db: database,`,
    `  storage,`,
    `  runner,`,
    `  scratchDir: dataDir,`,
    `  config: { concurrency: Number(process.env.WORKER_CONCURRENCY) || 2 },`,
    `});`,
    ``,
    `await worker.start();`,
    ``,
    `const shutdown = async () => { await worker.stop(); };`,
    `process.on("SIGTERM", () => { shutdown().catch(() => {}); });`,
    `process.on("SIGINT", () => { shutdown().catch(() => {}); });`,
    ``,
  ].join("\n");
}

function buildDeps(answers: Answers): Record<string, string> {
  const deps: Record<string, string> = {
    "@storyshelf/core": __PKG_VERSION__ ?? "0.0.0",
    "@storyshelf/worker": __PKG_VERSION__ ?? "0.0.0",
    "@storyshelf/runner-playwright": __PKG_VERSION__ ?? "0.0.0",
    [DB_PACKAGE[answers.database]]: __PKG_VERSION__ ?? "0.0.0",
  };
  if (answers.storage !== "local") {
    deps[STORAGE_PACKAGE[answers.storage]] = __PKG_VERSION__ ?? "0.0.0";
  }
  const qp = QUEUE_PACKAGE[answers.queue];
  if (qp) {
    deps[qp] = __PKG_VERSION__ ?? "0.0.0";
  }
  return deps;
}

function generatePackageJson(answers: Answers): string {
  const pkg = {
    name: answers.name,
    version: "0.1.0",
    type: "module",
    private: true,
    description: "StoryShelf capture worker (remote queue).",
    scripts: {
      start: "node --experimental-transform-types worker.ts",
      dev: "node --experimental-transform-types --watch worker.ts",
    },
    dependencies: buildDeps(answers),
    devDependencies: { typescript: "^7.0.2" },
  };
  return JSON.stringify(pkg, null, 2);
}

async function writeFiles(outDir: string, answers: Answers): Promise<void> {
  await writeFile(join(outDir, "worker.ts"), generateWorker(answers));
  printLine(`Created worker.ts`);
  await writeFile(join(outDir, "package.json"), generatePackageJson(answers));
  printLine(`Created package.json`);
  if (answers.docker) {
    await writeFile(join(outDir, "Dockerfile"), generateWorkerDockerfile());
    await writeFile(join(outDir, ".dockerignore"), generateDockerignore());
    printLine(`Created Dockerfile, .dockerignore`);
  }
}

function printNextSteps(answers: Answers, runner: PackageRunner): void {
  printLine(`\nScaffolded ${answers.name} in ${resolve(answers.dir)}`);
  printLine(`\nNext steps:`);
  printLine(`  cd ${answers.dir}`);
  if (answers.docker) {
    printLine(`  docker build -t storyshelf-worker .`);
    printLine(`  docker run --env-file .env storyshelf-worker`);
  } else {
    printLine(`  ${installCommand(runner)}`);
    printLine(`  npx storyshelf worker serve --dir .`);
  }
}

function promptInitial(choices: { value: string }[], value?: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const idx = choices.findIndex((c) => c.value === value);
  if (idx === -1) return undefined;
  return idx;
}

export async function runWorkerInit(_options: WorkerInitOptions): Promise<void> {
  const cwdPkg = detectInstalledAdapters(process.cwd());
  const infraWithInitial = WORKER_INFRA_PROMPTS.map((prompt) => {
    if (prompt.type !== "select") return prompt;
    const detected = cwdPkg[prompt.name as keyof typeof cwdPkg] as string | undefined;
    const initial = promptInitial(prompt.choices, detected);
    if (initial !== undefined) return { ...prompt, initial };
    return prompt;
  });

  const responses = (await prompts([...PROJECT_PROMPTS, ...infraWithInitial])) as Record<
    string,
    unknown
  >;
  if (!responses["name"] || !responses["dir"]) {
    printError("Cancelled.");
    return;
  }
  const answers = responses as unknown as Answers;
  if (!answers.queue) answers.queue = "sqs";
  const outDir = resolve(answers.dir);
  await mkdir(outDir, { recursive: true });
  await writeFiles(outDir, answers);
  printNextSteps(answers, await detectPackageRunner(process.cwd()));
}
