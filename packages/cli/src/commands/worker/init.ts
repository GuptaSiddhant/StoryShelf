declare const __PKG_VERSION__: string;

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import prompts from "prompts";
import { detectPackageRunner, installCommand, type PackageRunner } from "../../config.ts";
import { printError, printLine } from "../../output.ts";
import { generateDockerignore, generateWorkerDockerfile } from "../server/docker.ts";
import { PROJECT_PROMPTS, WORKER_INFRA_PROMPTS } from "../server/prompts.ts";
import { detectInstalledAdapters } from "../shared/detect-adapters.ts";
import {
  generateTsconfig,
  SCAFFOLD_DEV_DEPENDENCIES,
  WORKER_ENTRY,
  writeScaffoldFile,
} from "../shared/scaffold.ts";

export interface WorkerInitOptions {
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
type QueueChoice = "sqs" | "azure-storage-queues" | "azure-service-bus" | "gcp-pubsub" | "memory";

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

const QUEUE_PACKAGE: Record<QueueChoice, string | null> = {
  sqs: "@storyshelf/queue-sqs",
  "azure-storage-queues": "@storyshelf/queue-azure",
  "azure-service-bus": "@storyshelf/queue-azure",
  "gcp-pubsub": "@storyshelf/queue-gcp",
  memory: null,
};

/** Azure SDK pins (must match @storyshelf/queue-azure peerDependencies). */
const AZURE_STORAGE_QUEUE_SDK = "^12.31.0";
const AZURE_SERVICE_BUS_SDK = "^7.9.5";
/** Pub/Sub SDK pin (must match @storyshelf/queue-gcp peerDependencies). */
const GCP_PUBSUB_SDK = "^6.1.0";
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

function workerQueueImport(queue: QueueChoice): string {
  if (queue === "azure-storage-queues") {
    return `import { createAzureStorageQueuesQueue } from "@storyshelf/queue-azure/storage-queues";`;
  }
  if (queue === "azure-service-bus") {
    return `import { createAzureServiceBusQueue } from "@storyshelf/queue-azure/service-bus";`;
  }
  if (queue === "gcp-pubsub") {
    return `import { createGcpPubSubQueue } from "@storyshelf/queue-gcp";`;
  }
  if (queue === "sqs") {
    return `import { createSqsCaptureQueue } from "@storyshelf/queue-sqs";`;
  }
  return `// In-memory queue is server-side only; worker uses a remote queue.`;
}

function workerQueueInit(queue: QueueChoice): string {
  if (queue === "azure-storage-queues") {
    return `const queue = createAzureStorageQueuesQueue({ queueName: "capture-jobs", connectionString: process.env.AZURE_STORAGE_CONNECTION! });`;
  }
  if (queue === "azure-service-bus") {
    return `const queue = createAzureServiceBusQueue({ queueName: "capture-jobs", connectionString: process.env.AZURE_SERVICE_BUS_CONNECTION! });`;
  }
  if (queue === "gcp-pubsub") {
    return `const queue = createGcpPubSubQueue({ topic: "capture-jobs", subscription: "capture-jobs-worker", projectId: process.env.GOOGLE_CLOUD_PROJECT! });`;
  }
  if (queue === "sqs") {
    return `const queue = createSqsCaptureQueue({ queueUrl: process.env.QUEUE_URL! });`;
  }
  return `const queue = null as unknown as never; // replace with a remote queue`;
}

function generateWorker(answers: Answers): string {
  const queueLine = workerQueueImport(answers.queue);
  const queueInit = workerQueueInit(answers.queue);

  return [
    queueLine,
    `import { createCaptureWorker } from "@storyshelf/worker";`,
    `import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";`,
    DB_IMPORT[answers.database],
    STORAGE_IMPORT[answers.storage],
    ``,
    `const dataDir = process.env.DATA_DIR || "./data";`,
    ...dbPrelude(answers.database),
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
    `for (const signal of ["SIGINT", "SIGTERM"] as const) {`,
    `  process.once(signal, () => {`,
    `    void worker.stop();`,
    `  });`,
    `}`,
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
  const qp = QUEUE_PACKAGE[answers.queue];
  if (qp) {
    deps[qp] = __PKG_VERSION__ ?? "0.0.0";
  }
  if (answers.queue === "azure-storage-queues") {
    deps["@azure/storage-queue"] = AZURE_STORAGE_QUEUE_SDK;
  }
  if (answers.queue === "azure-service-bus") {
    deps["@azure/service-bus"] = AZURE_SERVICE_BUS_SDK;
  }
  if (answers.queue === "gcp-pubsub") {
    deps["@google-cloud/pubsub"] = GCP_PUBSUB_SDK;
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
    engines: { node: ">=24" },
    scripts: {
      start: `node ${WORKER_ENTRY}`,
      dev: `node --watch ${WORKER_ENTRY}`,
      typecheck: "tsc",
    },
    dependencies: buildDeps(answers),
    devDependencies: SCAFFOLD_DEV_DEPENDENCIES,
  };
  return JSON.stringify(pkg, null, 2);
}

async function writeFiles(outDir: string, answers: Answers): Promise<void> {
  await writeScaffoldFile(outDir, WORKER_ENTRY, generateWorker(answers));
  printLine(`Created ${WORKER_ENTRY}`);
  await writeFile(join(outDir, "package.json"), generatePackageJson(answers));
  await writeFile(join(outDir, "tsconfig.json"), generateTsconfig());
  printLine(`Created package.json, tsconfig.json`);
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
