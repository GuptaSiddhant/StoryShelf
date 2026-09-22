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
  generateComposeYaml,
  generateComposeYamlWithWorker,
  generateDockerfile,
  generateDockerignore,
  generateWorkerDockerfile,
} from "./docker.ts";
import {
  INFRA_PROMPTS,
  PROJECT_PROMPTS,
  AWS_INFRA_PROMPTS,
  AZURE_INFRA_PROMPTS,
} from "./prompts.ts";
import { generateAwsTerraformFiles } from "./terraform-aws.ts";
import { generateAzureTerraformFiles } from "./terraform-azure.ts";

/**
 * Options for `storyshelf server init` — scaffolds a new StoryShelf server project.
 */
export interface ServerInitOptions {
  /** Output directory for the generated server (defaults to `storyshelf-server`). */
  dir?: string;
}

type DatabaseChoice = "sqlite" | "turso" | "postgres";
type StorageChoice = "local" | "s3" | "azure";
type AuthChoice = "none" | "password" | "oauth";
type GitChoice = "none" | "github" | "gitlab";
type QueueChoice = "memory" | "sqs" | "redis" | "azure-storage-queues" | "azure-service-bus";
type DeployTarget = "local" | "docker" | "aws" | "azure";

/** Azure SDK pins (must match @storyshelf/queue-azure peerDependencies). */
const AZURE_STORAGE_QUEUE_SDK = "^12.31.0";
const AZURE_SERVICE_BUS_SDK = "^7.9.5";

/** npm peer SDK for the chosen Azure queue backend. */
function azureSdkDep(queue: "azure-storage-queues" | "azure-service-bus"): {
  name: string;
  version: string;
} {
  if (queue === "azure-service-bus") {
    return { name: "@azure/service-bus", version: AZURE_SERVICE_BUS_SDK };
  }
  return { name: "@azure/storage-queue", version: AZURE_STORAGE_QUEUE_SDK };
}

interface Answers {
  name: string;
  dir: string;
  database: DatabaseChoice;
  storage: StorageChoice;
  auth: AuthChoice;
  git: GitChoice;
  queue: QueueChoice;
  docker: boolean;
  includeWorker?: boolean;
  /** Deploy target. Absent in older mocked answers — derived from `docker`. */
  deployTarget?: DeployTarget;
  /** AWS-only follow-ups (asked when deployTarget is `aws`). */
  awsRegion?: string;
  dbEngine?: "rds" | "dsql";
  domainName?: string;
  samlMetadataUrl?: string;
  /** Azure-only follow-ups (asked when deployTarget is `azure`). */
  azureLocation?: string;
  azureQueueBackend?: "storage-queues" | "service-bus";
  entraTenantId?: string;
}

/** Remote queues need a separately-assembled worker; memory runs in-process. */
function isRemoteQueue(queue: QueueChoice): boolean {
  return queue !== "memory";
}

/** Normalize the deploy target, preserving pre-target answers. */
function resolveDeployTarget(answers: Answers): DeployTarget {
  return answers.deployTarget ?? (answers.docker ? "docker" : "local");
}

const DB_PACKAGE: Record<DatabaseChoice, string> = {
  sqlite: "@storyshelf/db-sqlite",
  turso: "@storyshelf/db-turso",
  postgres: "@storyshelf/db-postgres",
};

const STORAGE_PACKAGE: Record<StorageChoice, string> = {
  local: "@storyshelf/storage-local",
  s3: "@storyshelf/storage-s3",
  azure: "@storyshelf/storage-azure",
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

const QUEUE_PACKAGE: Record<QueueChoice, string | null> = {
  memory: null,
  sqs: "@storyshelf/queue-sqs",
  redis: "@storyshelf/queue-redis",
  "azure-storage-queues": "@storyshelf/queue-azure",
  "azure-service-bus": "@storyshelf/queue-azure",
};

const DB_IMPORT: Record<DatabaseChoice, string> = {
  sqlite: `import { createSqliteDatabase } from "@storyshelf/db-sqlite";`,
  turso: `import { createTursoDatabase } from "@storyshelf/db-turso";`,
  postgres: `import { createPostgresDatabase } from "@storyshelf/db-postgres";`,
};

const STORAGE_IMPORT: Record<StorageChoice, string> = {
  local: `import { createLocalStorage } from "@storyshelf/storage-local";`,
  s3: `import { createS3Storage } from "@storyshelf/storage-s3";`,
  azure: `import { createAzureStorage } from "@storyshelf/storage-azure";`,
};

const DB_INIT: Record<DatabaseChoice, string> = {
  sqlite: `createSqliteDatabase(\`\${dataDir}/shelf.db\`)`,
  turso: `createTursoDatabase({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN })`,
  postgres: `createPostgresDatabase({ url: process.env.DATABASE_URL! })`,
};

const STORAGE_INIT: Record<StorageChoice, string> = {
  local: `createLocalStorage(dataDir)`,
  s3: `createS3Storage({ bucket: process.env.S3_BUCKET!, region: process.env.AWS_REGION })`,
  azure: `createAzureStorage({ container: "storybook", connectionString: process.env.AZURE_STORAGE_CONNECTION! })`,
};

function buildImports(answers: Answers): string[] {
  const imports = [
    `import { serve } from "@hono/node-server";`,
    `import { createShelfApp } from "@storyshelf/app";`,
    DB_IMPORT[answers.database],
    STORAGE_IMPORT[answers.storage],
  ];

  if (answers.queue === "sqs") {
    imports.push(`import { createSqsCaptureQueue } from "@storyshelf/queue-sqs";`);
  }
  if (answers.queue === "redis") {
    imports.push(`import { createRedisCaptureQueue } from "@storyshelf/queue-redis";`);
  }
  if (answers.queue === "azure-storage-queues") {
    imports.push(
      `import { createAzureStorageQueuesQueue } from "@storyshelf/queue-azure/storage-queues";`,
    );
  }
  if (answers.queue === "azure-service-bus") {
    imports.push(
      `import { createAzureServiceBusQueue } from "@storyshelf/queue-azure/service-bus";`,
    );
  }

  if (answers.auth === "password") {
    imports.push(`import { createPasswordAuth } from "${AUTH_PACKAGE[answers.auth]}";`);
  }
  if (answers.auth === "oauth") {
    imports.push(`import { createOAuthAuth } from "@storyshelf/auth-oauth";`);
    if (resolveDeployTarget(answers) === "aws") {
      imports.push(`import { cognitoPreset } from "@storyshelf/auth-oauth/presets";`);
    }
  }
  if (answers.git !== "none") {
    const host = answers.git === "github" ? "gitHubHost" : "gitLabHost";
    imports.push(`import { ${host} } from "${GIT_PACKAGE[answers.git]}";`);
  }
  if (answers.queue === "memory") {
    imports.push(`import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";`);
  }
  return imports;
}

function buildAdapterLines(answers: Answers): string[] {
  const lines = [
    `// Adapters — swap these for your deployment`,
    `const database = ${DB_INIT[answers.database]};`,
    `const storage = ${STORAGE_INIT[answers.storage]};`,
  ];
  if (answers.queue === "sqs") {
    lines.push(`const captureQueue = createSqsCaptureQueue({ queueUrl: process.env.QUEUE_URL! });`);
  }
  if (answers.queue === "redis") {
    lines.push(`const captureQueue = createRedisCaptureQueue({ url: process.env.REDIS_URL! });`);
  }
  if (answers.queue === "azure-storage-queues") {
    lines.push(
      `const captureQueue = createAzureStorageQueuesQueue({ queueName: "capture-jobs", connectionString: process.env.AZURE_STORAGE_CONNECTION! });`,
    );
  }
  if (answers.queue === "azure-service-bus") {
    lines.push(
      `const captureQueue = createAzureServiceBusQueue({ queueName: "capture-jobs", connectionString: process.env.AZURE_SERVICE_BUS_CONNECTION! });`,
    );
  }
  if (answers.queue === "memory") {
    lines.push(`const captureRunner = createPlaywrightCaptureRunner();`);
  }
  return lines;
}

function buildRouterLines(answers: Answers): string[] {
  const lines = [`const app = createShelfApp({`, `  database,`, `  storage,`];

  if (isRemoteQueue(answers.queue)) {
    lines.push(`  captureQueue,`);
  } else {
    lines.push(`  captureRunner,`);
  }

  if (answers.auth === "password") {
    lines.push(`  auth: createPasswordAuth({ password: process.env.AUTH_PASSWORD! }),`);
  }
  if (answers.auth === "oauth" && resolveDeployTarget(answers) === "aws") {
    lines.push(
      `  auth: createOAuthAuth(cognitoPreset(process.env.COGNITO_REGION!, process.env.COGNITO_USER_POOL_ID!, {`,
      `    clientId: process.env.OIDC_CLIENT_ID!,`,
      `    clientSecret: process.env.OIDC_CLIENT_SECRET!,`,
      `    secret: process.env.SECRET!,`,
      `    redirectUrl: process.env.OIDC_REDIRECT_URL!,`,
      `    adminGroups: (process.env.ADMIN_GROUPS ?? "shelf-admins").split(","),`,
      `  })),`,
    );
  }
  if (answers.auth === "oauth" && resolveDeployTarget(answers) !== "aws") {
    lines.push(
      `  auth: createOAuthAuth({`,
      `    issuer: process.env.OIDC_ISSUER!,`,
      `    clientId: process.env.OIDC_CLIENT_ID!,`,
      `    clientSecret: process.env.OIDC_CLIENT_SECRET!,`,
      `    secret: process.env.SECRET!,`,
      `    redirectUrl: process.env.OIDC_REDIRECT_URL!,`,
      `  }),`,
    );
  }
  if (answers.git !== "none") {
    const host = answers.git === "github" ? "gitHubHost" : "gitLabHost";
    lines.push(`  gitHosts: [${host}],`);
  }

  if (answers.queue === "memory") {
    lines.push(
      `  config: {`,
      `    secret: process.env.SECRET,`,
      `    scratchDir: dataDir,`,
      `  },`,
    );
  } else {
    lines.push(`  config: {`, `    secret: process.env.SECRET,`, `  },`);
  }
  lines.push(`});`, ``, `await app.lifecycle.setup();`, `const logger = app.lifecycle.logger;`);

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
    `  await app.lifecycle.teardown();`,
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

function workerQueueImport(queue: QueueChoice): string {
  if (queue === "redis") {
    return `import { createRedisCaptureQueue } from "@storyshelf/queue-redis";`;
  }
  if (queue === "azure-storage-queues") {
    return `import { createAzureStorageQueuesQueue } from "@storyshelf/queue-azure/storage-queues";`;
  }
  if (queue === "azure-service-bus") {
    return `import { createAzureServiceBusQueue } from "@storyshelf/queue-azure/service-bus";`;
  }
  return `import { createSqsCaptureQueue } from "@storyshelf/queue-sqs";`;
}

function workerQueueInit(queue: QueueChoice): string {
  if (queue === "redis") {
    return `const queue = createRedisCaptureQueue({ url: process.env.REDIS_URL! });`;
  }
  if (queue === "azure-storage-queues") {
    return `const queue = createAzureStorageQueuesQueue({ queueName: "capture-jobs", connectionString: process.env.AZURE_STORAGE_CONNECTION! });`;
  }
  if (queue === "azure-service-bus") {
    return `const queue = createAzureServiceBusQueue({ queueName: "capture-jobs", connectionString: process.env.AZURE_SERVICE_BUS_CONNECTION! });`;
  }
  return `const queue = createSqsCaptureQueue({ queueUrl: process.env.QUEUE_URL! });`;
}

function generateWorkerFile(answers: Answers): string {
  const queueImport = workerQueueImport(answers.queue);
  const queueInit = workerQueueInit(answers.queue);
  return [
    queueImport,
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
    `const shutdown = async () => {`,
    `  await worker.stop();`,
    `};`,
    `process.on("SIGTERM", () => { shutdown().catch(() => {}); });`,
    `process.on("SIGINT", () => { shutdown().catch(() => {}); });`,
    ``,
  ].join("\n");
}

function buildDeps(answers: Answers): Record<string, string> {
  const deps: Record<string, string> = {
    "@hono/node-server": "^1.17.0",
    "@storyshelf/core": __PKG_VERSION__ ?? "0.0.0",
    "@storyshelf/app": __PKG_VERSION__ ?? "0.0.0",
    [DB_PACKAGE[answers.database]]: __PKG_VERSION__ ?? "0.0.0",
  };

  if (answers.storage !== "local") {
    deps[STORAGE_PACKAGE[answers.storage]] = __PKG_VERSION__ ?? "0.0.0";
  }
  if (answers.queue === "sqs" || answers.queue === "redis") {
    const queuePkg =
      answers.queue === "redis" ? "@storyshelf/queue-redis" : "@storyshelf/queue-sqs";
    deps[queuePkg] = __PKG_VERSION__ ?? "0.0.0";
    if (answers.includeWorker) {
      deps["@storyshelf/worker"] = __PKG_VERSION__ ?? "0.0.0";
      deps["@storyshelf/runner-playwright"] = __PKG_VERSION__ ?? "0.0.0";
    }
  } else if (answers.queue === "azure-storage-queues" || answers.queue === "azure-service-bus") {
    deps["@storyshelf/queue-azure"] = __PKG_VERSION__ ?? "0.0.0";
    const sdk = azureSdkDep(answers.queue);
    deps[sdk.name] = sdk.version;
    if (answers.includeWorker) {
      deps["@storyshelf/worker"] = __PKG_VERSION__ ?? "0.0.0";
      deps["@storyshelf/runner-playwright"] = __PKG_VERSION__ ?? "0.0.0";
    }
  } else {
    deps["@storyshelf/runner-playwright"] = __PKG_VERSION__ ?? "0.0.0";
  }
  if (answers.auth !== "none") {
    deps[AUTH_PACKAGE[answers.auth] ?? ""] = __PKG_VERSION__ ?? "0.0.0";
  }
  if (answers.git !== "none") {
    deps[GIT_PACKAGE[answers.git] ?? ""] = __PKG_VERSION__ ?? "0.0.0";
  }
  // Queue dep when sqs
  if (answers.queue !== "memory") {
    const queuePkg = QUEUE_PACKAGE[answers.queue];
    if (queuePkg) {
      deps[queuePkg] = __PKG_VERSION__ ?? "0.0.0";
    }
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

  if (answers.includeWorker) {
    (pkg.scripts as Record<string, string>)["worker"] =
      "node --experimental-transform-types worker.ts";
    (pkg.scripts as Record<string, string>)["worker:dev"] =
      "node --experimental-transform-types --watch worker.ts";
  }

  if (resolveDeployTarget(answers) === "docker") {
    const scripts = pkg.scripts as Record<string, string>;
    scripts["docker:build"] = "docker compose build";
    scripts["docker:up"] = "docker compose up --build";
    scripts["docker:down"] = "docker compose down";
    scripts["docker:logs"] = "docker compose logs -f";
  }

  if (resolveDeployTarget(answers) === "aws" || resolveDeployTarget(answers) === "azure") {
    addInfraScripts(pkg.scripts as Record<string, string>);
  }

  return JSON.stringify(pkg, null, 2);
}

async function writeFiles(outDir: string, answers: Answers): Promise<void> {
  const serverCode = generateServer(answers);
  await writeFile(join(outDir, "server.ts"), serverCode);
  printLine(`Created server.ts`);

  if (answers.includeWorker) {
    const workerCode = generateWorkerFile(answers);
    await writeFile(join(outDir, "worker.ts"), workerCode);
    printLine(`Created worker.ts`);
  }

  const pkgCode = generatePackageJson(answers);
  await writeFile(join(outDir, "package.json"), pkgCode);
  printLine(`Created package.json`);

  if (resolveDeployTarget(answers) === "aws") {
    await writeTerraformFiles(outDir, answers);
  }

  if (resolveDeployTarget(answers) === "azure") {
    await writeAzureTerraformFiles(outDir, answers);
  }

  await writeDockerFiles(outDir, answers);
}

/** Write the Azure Terraform reference stack (`terraform/*.tf` + README). */
async function writeAzureTerraformFiles(outDir: string, answers: Answers): Promise<void> {
  const files = generateAzureTerraformFiles({
    project: answers.name,
    location: answers.azureLocation ?? "eastus",
    queueBackend: answers.azureQueueBackend ?? "storage-queues",
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

  if (isRemoteQueue(answers.queue) && answers.includeWorker) {
    // Server is slim when queue is remote; worker has playwright
    const slimDockerfile = [
      "FROM node:lts-alpine",
      "WORKDIR /app",
      "COPY package.json ./",
      "RUN npm install --omit=dev",
      "COPY server.ts ./",
      "RUN npx esbuild server.ts --bundle --platform=node --format=esm --outfile=dist/server.mjs",
      "EXPOSE 3000",
      'CMD ["node", "dist/server.mjs"]',
    ].join("\n");
    await writeFile(join(outDir, "Dockerfile"), slimDockerfile);
    await writeFile(join(outDir, "Dockerfile.worker"), generateWorkerDockerfile());
    await writeFile(join(outDir, ".dockerignore"), generateDockerignore());
    await writeFile(join(outDir, "compose.yaml"), generateComposeYamlWithWorker(answers.database));
    printLine(`Created Dockerfile, Dockerfile.worker, .dockerignore, compose.yaml`);
    return;
  }

  await writeFile(join(outDir, "Dockerfile"), generateDockerfile());
  await writeFile(join(outDir, ".dockerignore"), generateDockerignore());
  await writeFile(join(outDir, "compose.yaml"), generateComposeYaml(answers.database));
  printLine(`Created Dockerfile, .dockerignore, compose.yaml`);
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
    printLine(`  #   S3_BUCKET / AWS_REGION, QUEUE_URL, DATABASE_URL, COGNITO_* credentials`);
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
    printLine(
      `  #   AZURE_STORAGE_CONNECTION (+ AZURE_SERVICE_BUS_CONNECTION), DATABASE_URL, OIDC_* credentials`,
    );
    printLine(`  npm install`);
    printLine(`  npm start`);
    return;
  }

  if (target === "docker") {
    printLine(`  npm run docker:up      # builds + starts app (+ worker)`);
    printLine(`  npm run docker:logs    # follow logs`);
    printLine(`  npm run docker:down    # tear down`);
    if (answers.includeWorker) {
      printLine(`  # or separately:`);
      printLine(`  # docker compose up storyshelf worker`);
    }
    return;
  }

  printLine(`  ${installCommand(runner)}`);
  printLine(`  ${startCommand(runner)}`);
  if (answers.includeWorker) {
    printLine(`  # in another terminal:`);
    printLine(`  npx storyshelf worker serve --dir .`);
  }
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
  // Try to autofill from existing package.json (standalone worker dir or re-init)
  const cwdPkg = detectInstalledAdapters(process.cwd());

  const infraWithInitial = INFRA_PROMPTS.map((prompt) => {
    if (prompt.type !== "select") {
      return prompt;
    }
    const detected = cwdPkg[prompt.name as keyof typeof cwdPkg] as string | undefined;
    const initial = promptInitial(prompt.choices, detected);
    if (initial !== undefined) {
      return { ...prompt, initial };
    }
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
  // Default queue to memory if not answered (prompts initial unset)
  if (!answers.queue) {
    answers.queue = "memory";
  }

  // AWS target: fixed enterprise reference stack (Postgres + S3 + SQS +
  // colocated worker). Dockerfiles still generate for ECR image builds.
  if (resolveDeployTarget(answers) === "aws") {
    answers.database = "postgres";
    answers.storage = "s3";
    answers.queue = "sqs";
    answers.includeWorker = true;
    answers.docker = true;
    const awsAnswers = (await prompts(AWS_INFRA_PROMPTS)) as Record<string, unknown>;
    answers.awsRegion = (awsAnswers["awsRegion"] as string | undefined) ?? "us-east-1";
    answers.dbEngine = (awsAnswers["dbEngine"] as "rds" | "dsql" | undefined) ?? "rds";
    answers.domainName = (awsAnswers["domainName"] as string | undefined) ?? undefined;
    answers.samlMetadataUrl = (awsAnswers["samlMetadataUrl"] as string | undefined) ?? undefined;
  }

  // Azure target: fixed enterprise reference stack (Postgres + Blob +
  // Storage Queues/Service Bus + colocated worker). Dockerfiles still
  // generate for ACR image builds.
  if (resolveDeployTarget(answers) === "azure") {
    answers.database = "postgres";
    answers.storage = "azure";
    answers.includeWorker = true;
    answers.docker = true;
    const azureAnswers = (await prompts(AZURE_INFRA_PROMPTS)) as Record<string, unknown>;
    answers.azureLocation = (azureAnswers["azureLocation"] as string | undefined) ?? "eastus";
    const backend = azureAnswers["azureQueueBackend"] as
      | "storage-queues"
      | "service-bus"
      | undefined;
    answers.azureQueueBackend = backend ?? "storage-queues";
    answers.queue =
      answers.azureQueueBackend === "service-bus" ? "azure-service-bus" : "azure-storage-queues";
    answers.domainName = (azureAnswers["domainName"] as string | undefined) ?? undefined;
    answers.entraTenantId = (azureAnswers["entraTenantId"] as string | undefined) ?? undefined;
  }

  // Hybrid: if queue is remote, ask whether to generate worker alongside
  if (
    resolveDeployTarget(answers) !== "aws" &&
    resolveDeployTarget(answers) !== "azure" &&
    isRemoteQueue(answers.queue)
  ) {
    const workerAnswer = (await prompts({
      type: "confirm",
      name: "includeWorker",
      message: "Generate worker service alongside server?",
      initial: true,
    } as never)) as Record<string, unknown>;
    const includeWorkerValue = workerAnswer["includeWorker"] as boolean | undefined;
    answers.includeWorker = includeWorkerValue ?? true;
  }

  const outDir = resolve(answers.dir);
  await mkdir(outDir, { recursive: true });

  await writeFiles(outDir, answers);
  printNextSteps(answers, await detectPackageRunner(process.cwd()));
}
