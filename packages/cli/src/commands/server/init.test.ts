import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpRoot: string;
let dir: string;

vi.mock("prompts", () => ({
  default: vi.fn(),
}));

import prompts from "prompts";
import { runServerInit } from "./init.ts";

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "storyshelf-server-init-"));
  dir = join(tmpRoot, "my-server");
  vi.mocked(prompts).mockReset();
  vi.stubGlobal("__PKG_VERSION__", "0.3.2");
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(tmpRoot, { recursive: true, force: true });
});

async function scaffold(answers: Record<string, unknown>): Promise<void> {
  vi.mocked(prompts).mockResolvedValue({
    name: "my-server",
    dir: "./my-server",
    database: "sqlite",
    storage: "local",
    auth: "none",
    git: "none",
    queue: "memory",
    docker: false,
    ...answers,
  });
  const cwd = process.cwd();
  process.chdir(tmpRoot);
  try {
    await runServerInit({});
  } finally {
    process.chdir(cwd);
  }
}

function readScripts(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  return pkg.scripts;
}

describe("runServerInit", () => {
  it("scaffolds turso from the db-sqlite subpath with the libsql peer", async () => {
    vi.mocked(prompts).mockResolvedValue({
      name: "my-server",
      dir: "./my-server",
      database: "turso",
      storage: "local",
      auth: "none",
      git: "none",
      queue: "memory",
      docker: false,
    });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    const code = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(code).toContain('from "@storyshelf/db-sqlite/turso"');
    expect(code).toContain("createTursoDatabase");
    expect(code).not.toContain("@storyshelf/db-turso");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/db-sqlite"]).toBeDefined();
    expect(pkg.dependencies["@libsql/client"]).toBeDefined();
  });

  it("scaffolds d1 with a binding stub", async () => {
    vi.mocked(prompts).mockResolvedValue({
      name: "my-server",
      dir: "./my-server",
      database: "d1",
      storage: "local",
      auth: "none",
      git: "none",
      queue: "memory",
      docker: false,
    });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    const code = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(code).toContain('from "@storyshelf/db-sqlite/d1"');
    expect(code).toContain("getD1Binding");
  });

  it("scaffolds better-sqlite3 with its peer dep", async () => {
    vi.mocked(prompts).mockResolvedValue({
      name: "my-server",
      dir: "./my-server",
      database: "better-sqlite3",
      storage: "local",
      auth: "none",
      git: "none",
      queue: "memory",
      docker: false,
    });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    const code = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(code).toContain("createBetterSqlite3Database");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["better-sqlite3"]).toBeDefined();
  });

  it("scaffolds src/index.ts with in-memory queue", async () => {
    vi.mocked(prompts).mockResolvedValue({
      name: "my-server",
      dir: "./my-server",
      database: "sqlite",
      storage: "local",
      auth: "none",
      git: "none",
      queue: "memory",
      docker: false,
    });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    expect(existsSync(join(dir, "src", "index.ts"))).toBe(true);
    const code = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(code).toContain("createShelfApp");
    expect(code).toContain("createPlaywrightCaptureRunner");
    expect(code).not.toContain("createSqsCaptureQueue");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/runner-playwright"]).toBeDefined();
    expect(pkg.dependencies["@storyshelf/queue-sqs"]).toBeUndefined();
  });

  it("scaffolds server with SQS queue and colocated worker", async () => {
    // Phased flow: phase-1 answers, advanced toggle, phase-2 adapters, worker confirm
    const main = {
      name: "my-server",
      dir: "./my-server",
      deployTarget: "docker",
      database: "turso",
      storage: "s3",
      auth: "none",
      git: "none",
      queue: "sqs",
      docker: false,
    };
    vi.mocked(prompts)
      .mockResolvedValueOnce({ ...main })
      .mockResolvedValueOnce({ advancedAdapters: true })
      .mockResolvedValueOnce({ ...main })
      .mockResolvedValueOnce({ includeWorker: true });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    expect(existsSync(join(dir, "src", "index.ts"))).toBe(true);
    expect(existsSync(join(dir, "src", "worker.ts"))).toBe(true);
    const serverCode = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(serverCode).toContain("createSqsCaptureQueue");
    expect(serverCode).not.toContain("createPlaywrightCaptureRunner");
    const workerCode = readFileSync(join(dir, "src", "worker.ts"), "utf8");
    expect(workerCode).toContain("createCaptureWorker");
    expect(workerCode).toContain("createPlaywrightCaptureRunner");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/queue-sqs"]).toBeDefined();
    expect(pkg.dependencies["@storyshelf/worker"]).toBeDefined();
    expect(pkg.scripts["worker"]).toBeDefined();
  });

  it("scaffolds SQS server without worker when declined", async () => {
    const main = {
      name: "my-server",
      dir: "./my-server",
      deployTarget: "docker",
      database: "sqlite",
      storage: "local",
      auth: "none",
      git: "none",
      queue: "sqs",
      docker: false,
    };
    vi.mocked(prompts)
      .mockResolvedValueOnce({ ...main })
      .mockResolvedValueOnce({ advancedAdapters: false })
      .mockResolvedValueOnce({ ...main })
      .mockResolvedValueOnce({ includeWorker: false });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    expect(existsSync(join(dir, "src", "index.ts"))).toBe(true);
    expect(existsSync(join(dir, "src", "worker.ts"))).toBe(false);
  });

  it("generates slim Dockerfile and worker compose when with worker and docker", async () => {
    const main = {
      name: "my-server",
      dir: "./my-server",
      deployTarget: "docker",
      database: "postgres",
      storage: "local",
      auth: "none",
      git: "none",
      queue: "sqs",
      docker: true,
    };
    vi.mocked(prompts)
      .mockResolvedValueOnce({ ...main })
      .mockResolvedValueOnce({ advancedAdapters: false })
      .mockResolvedValueOnce({ ...main })
      .mockResolvedValueOnce({ includeWorker: true });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    expect(existsSync(join(dir, "Dockerfile"))).toBe(true);
    expect(existsSync(join(dir, "Dockerfile.worker"))).toBe(true);
    expect(existsSync(join(dir, "compose.yaml"))).toBe(true);
    const compose = readFileSync(join(dir, "compose.yaml"), "utf8");
    expect(compose).toContain("worker:");
    expect(compose).toContain("postgres:");
    const dockerfile = readFileSync(join(dir, "Dockerfile.worker"), "utf8");
    expect(dockerfile).toContain("mcr.microsoft.com/playwright");
  });

  it("cancels when name missing", async () => {
    vi.mocked(prompts).mockResolvedValue({});
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }
    expect(existsSync(dir)).toBe(false);
  });

  it("defaults queue to memory when not answered", async () => {
    vi.mocked(prompts).mockResolvedValue({
      name: "my-server",
      dir: "./my-server",
      database: "sqlite",
      storage: "local",
      auth: "none",
      git: "none",
      // queue intentionally omitted
      docker: false,
    });
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }
    const code = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(code).toContain("captureRunner");
  });

  it("writes the AWS reference stack and forces postgres/s3/sqs", async () => {
    vi.mocked(prompts)
      .mockResolvedValueOnce({
        name: "my-server",
        dir: "./my-server",
        deployTarget: "aws",
        database: "sqlite",
        storage: "local",
        auth: "oauth",
        git: "github",
        queue: "memory",
        docker: false,
      })
      .mockResolvedValueOnce({
        awsRegion: "eu-west-1",
        dbEngine: "dsql",
        domainName: "",
        samlMetadataUrl: "",
      });
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    const serverCode = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(serverCode).toContain("createPostgresDatabase");
    expect(serverCode).toContain("createS3Storage");
    expect(serverCode).toContain("createSqsCaptureQueue");
    expect(serverCode).toContain("cognitoPreset");
    expect(existsSync(join(dir, "src", "worker.ts"))).toBe(true);
    expect(existsSync(join(dir, "terraform", "database.tf"))).toBe(true);
    const databaseTf = readFileSync(join(dir, "terraform", "database.tf"), "utf8");
    expect(databaseTf).toContain("aws_dsql_cluster");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/db-postgres"]).toBeDefined();
    expect(pkg.scripts["infra:plan"]).toBeDefined();
    expect(pkg.scripts["infra:apply"]).toBeDefined();
    expect(pkg.scripts["docker:up"]).toBeUndefined();
  });

  it("writes the Azure reference stack and forces postgres/azure/service-bus", async () => {
    vi.mocked(prompts)
      .mockResolvedValueOnce({
        name: "my-server",
        dir: "./my-server",
        deployTarget: "azure",
        database: "sqlite",
        storage: "local",
        auth: "oauth",
        git: "github",
        queue: "memory",
        docker: false,
      })
      .mockResolvedValueOnce({
        azureLocation: "westeurope",
        azureQueueBackend: "service-bus",
        domainName: "",
        entraTenantId: "",
      });
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    const serverCode = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(serverCode).toContain("createPostgresDatabase");
    expect(serverCode).toContain("createAzureStorage");
    expect(serverCode).toContain("createAzureServiceBusQueue");
    expect(serverCode).toContain("AZURE_SERVICE_BUS_CONNECTION");
    expect(serverCode).not.toContain("cognitoPreset");
    expect(serverCode).toContain("OIDC_ISSUER");
    expect(existsSync(join(dir, "src", "worker.ts"))).toBe(true);
    const workerCode = readFileSync(join(dir, "src", "worker.ts"), "utf8");
    expect(workerCode).toContain("createAzureServiceBusQueue");
    expect(existsSync(join(dir, "terraform", "queue.tf"))).toBe(true);
    const queueTf = readFileSync(join(dir, "terraform", "queue.tf"), "utf8");
    expect(queueTf).toContain("azurerm_servicebus_queue");
    expect(existsSync(join(dir, "terraform", "terraform.tfvars.example"))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/db-postgres"]).toBeDefined();
    expect(pkg.dependencies["@storyshelf/storage-azure"]).toBeDefined();
    expect(pkg.dependencies["@storyshelf/queue-azure"]).toBeDefined();
    expect(pkg.dependencies["@azure/service-bus"]).toBe("^7.9.5");
    expect(pkg.scripts["infra:plan"]).toBeDefined();
    expect(pkg.scripts["infra:apply"]).toBeDefined();
    expect(pkg.scripts["docker:up"]).toBeUndefined();
  });

  it("writes the GCP reference stack and forces postgres/gcs/pubsub", async () => {
    vi.mocked(prompts)
      .mockResolvedValueOnce({
        name: "my-server",
        dir: "./my-server",
        deployTarget: "gcp",
        database: "sqlite",
        storage: "local",
        auth: "oauth",
        git: "github",
        queue: "memory",
        docker: false,
      })
      .mockResolvedValueOnce({
        gcpProjectId: "acme-gcp-project",
        gcpLocation: "europe-west1",
        domainName: "",
        identityTenant: "",
      });
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    const serverCode = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(serverCode).toContain("createPostgresDatabase");
    expect(serverCode).toContain("createGcsStorage");
    expect(serverCode).toContain("createGcpPubSubQueue");
    expect(serverCode).toContain("GOOGLE_CLOUD_PROJECT");
    expect(serverCode).not.toContain("cognitoPreset");
    expect(existsSync(join(dir, "src", "worker.ts"))).toBe(true);
    const workerCode = readFileSync(join(dir, "src", "worker.ts"), "utf8");
    expect(workerCode).toContain("createGcpPubSubQueue");
    expect(existsSync(join(dir, "terraform", "queue.tf"))).toBe(true);
    const queueTf = readFileSync(join(dir, "terraform", "queue.tf"), "utf8");
    expect(queueTf).toContain("google_pubsub_subscription");
    expect(existsSync(join(dir, "terraform", "terraform.tfvars.example"))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/db-postgres"]).toBeDefined();
    expect(pkg.dependencies["@storyshelf/storage-gcs"]).toBeDefined();
    expect(pkg.dependencies["@storyshelf/queue-gcp"]).toBeDefined();
    expect(pkg.dependencies["@google-cloud/pubsub"]).toBe("^6.1.0");
    expect(pkg.scripts["infra:plan"]).toBeDefined();
    expect(pkg.scripts["infra:apply"]).toBeDefined();
    expect(pkg.scripts["docker:up"]).toBeUndefined();
  });

  it("emits OIDC wiring for oauth on non-AWS targets", async () => {
    vi.mocked(prompts).mockResolvedValue({
      name: "my-server",
      dir: "./my-server",
      deployTarget: "local",
      database: "sqlite",
      storage: "local",
      auth: "oauth",
      git: "none",
      queue: "memory",
      docker: false,
    });
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }
    const code = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(code).toContain("createShelfAuth");
    expect(code).toContain("keycloakPreset");
    expect(code).toContain("OIDC_ISSUER");
    expect(code).not.toContain("cognitoPreset");
    expect(existsSync(join(dir, "terraform"))).toBe(false);
  });

  it("uses plain docker scripts and no compose file for a single container", async () => {
    await scaffold({ deployTarget: "docker", docker: true });
    const scripts = readScripts();
    expect(scripts["docker:build"]).toBe("docker build -t my-server .");
    expect(scripts["docker:run"]).toContain("docker run");
    expect(scripts["docker:up"]).toBeUndefined();
    expect(scripts["infra:plan"]).toBeUndefined();
    expect(existsSync(join(dir, "Dockerfile"))).toBe(true);
    expect(existsSync(join(dir, "compose.yaml"))).toBe(false);
  });

  it("generates compose when the stack has more than one service", async () => {
    await scaffold({ deployTarget: "docker", docker: true, database: "postgres" });
    const scripts = readScripts();
    expect(scripts["docker:up"]).toBe("docker compose up --build");
    expect(scripts["docker:run"]).toBeUndefined();
    expect(existsSync(join(dir, "compose.yaml"))).toBe(true);
  });

  it("generates compose with a worker service for a remote queue", async () => {
    await scaffold({
      deployTarget: "docker",
      docker: true,
      database: "postgres",
      storage: "s3",
      queue: "sqs",
      includeWorker: true,
    });
    const compose = readFileSync(join(dir, "compose.yaml"), "utf8");
    expect(compose.indexOf("  worker:")).toBeLessThan(compose.indexOf("\nvolumes:"));
    expect(existsSync(join(dir, "Dockerfile.worker"))).toBe(true);
  });

  it("copies the src directory in the Dockerfile and runs src/index.ts", async () => {
    await scaffold({ deployTarget: "docker", docker: true });
    const dockerfile = readFileSync(join(dir, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("COPY src/ ./src/");
    expect(dockerfile).toContain('"src/index.ts"');
    expect(dockerfile).not.toContain("esbuild");
  });

  it("writes a tsconfig covering src and the typing dependencies", async () => {
    await scaffold({});
    const tsconfig = JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf8")) as {
      include: string[];
    };
    expect(tsconfig.include).toEqual(["src"]);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies["@types/node"]).toBeDefined();
    expect(pkg.devDependencies["typescript"]).toBeDefined();
    expect(pkg.scripts["start"]).toContain("src/index.ts");
    expect(pkg.scripts["typecheck"]).toBe("tsc");
    expect(existsSync(join(dir, "server.ts"))).toBe(false);
  });

  it("keeps the default output lean: no notifications, no observability", async () => {
    await scaffold({});
    const code = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(code).not.toContain("notify-");
    expect(code).not.toContain("observability");
    expect(code).not.toContain("createShelfLogger");
    expect(code).not.toContain("const logger");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).toSorted()).toEqual([
      "@hono/node-server",
      "@storyshelf/app",
      "@storyshelf/db-sqlite",
      "@storyshelf/runner-playwright",
    ]);
  });

  it("wires OpenTelemetry only when observability is chosen", async () => {
    await scaffold({ observability: true });
    const code = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(code).toContain("initObservabilityFromEnv");
    expect(code).toContain("logger: shelfLogger,");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/observability"]).toBeDefined();
    expect(pkg.dependencies["@storyshelf/core"]).toBeDefined();
  });

  it("does not declare the auth package or import the engine when auth is none", async () => {
    await scaffold({});
    const code = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(code).not.toContain("@storyshelf/auth");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/auth"]).toBeUndefined();
  });

  it("merges imports that share a module into one line", async () => {
    await scaffold({ auth: "oauth", notifications: true });
    const code = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(code.match(/from "@storyshelf\/auth"/gu)).toHaveLength(1);
    expect(code.match(/from "@storyshelf\/app"/gu)).toHaveLength(1);
  });

  it("only declares dataDir when the stack reads it", async () => {
    await scaffold({ database: "postgres", storage: "s3", queue: "sqs", includeWorker: false });
    expect(readFileSync(join(dir, "src", "index.ts"), "utf8")).not.toContain("dataDir");
    await scaffold({});
    expect(readFileSync(join(dir, "src", "index.ts"), "utf8")).toContain("dataDir");
  });

  it("wires notifications when enabled", async () => {
    vi.mocked(prompts).mockResolvedValue({
      name: "my-server",
      dir: "./my-server",
      database: "sqlite",
      storage: "local",
      auth: "password",
      git: "none",
      queue: "memory",
      docker: false,
      notifications: true,
    });
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }
    const code = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(code).toContain("chatNotifiers");
    expect(code).toContain("smtpPresetFromEnv");
    expect(code).toContain("onAuthSystemEvent: createAuthSystemHook()");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/notify-chat"]).toBeDefined();
    expect(pkg.dependencies["@storyshelf/notify-email"]).toBeDefined();
    expect(pkg.dependencies["nodemailer"]).toBeDefined();
  });

  it("omits notifications when disabled", async () => {
    vi.mocked(prompts).mockResolvedValue({
      name: "my-server",
      dir: "./my-server",
      database: "sqlite",
      storage: "local",
      auth: "password",
      git: "none",
      queue: "memory",
      docker: false,
      notifications: false,
    });
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }
    const code = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(code).not.toContain("chatNotifiers");
    expect(code).not.toContain("smtpPresetFromEnv");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/notify-chat"]).toBeUndefined();
  });

  it("asks deploy target first, then curated adapters on local", async () => {
    const phase1 = { name: "my-server", dir: "./my-server", deployTarget: "local" };
    const adapters = {
      database: "sqlite",
      storage: "local",
      auth: "none",
      git: "none",
      queue: "memory",
      docker: false,
      notifications: false,
    };
    vi.mocked(prompts)
      .mockResolvedValueOnce({ ...phase1 })
      .mockResolvedValueOnce({ advancedAdapters: false })
      .mockResolvedValueOnce({ ...adapters });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    // Phase 2 database menu is the curated 4, not the full 14.
    const phase2Call = vi.mocked(prompts).mock.calls[2]?.[0] as Array<{ choices?: unknown[] }>;
    const dbPrompt = phase2Call.find((p) => (p as { name?: string }).name === "database") as {
      choices: unknown[];
    };
    expect(dbPrompt.choices).toHaveLength(4);

    const code = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(code).toContain("createSqliteDatabase");
  });

  it("shows the full matrix when advanced adapters is on", async () => {
    const phase1 = { name: "my-server", dir: "./my-server", deployTarget: "local" };
    const adapters = {
      database: "turso",
      storage: "local",
      auth: "none",
      git: "none",
      queue: "memory",
      docker: false,
      notifications: false,
    };
    vi.mocked(prompts)
      .mockResolvedValueOnce({ ...phase1 })
      .mockResolvedValueOnce({ advancedAdapters: true })
      .mockResolvedValueOnce({ ...adapters });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    const phase2Call = vi.mocked(prompts).mock.calls[2]?.[0] as Array<{ choices?: unknown[] }>;
    const dbPrompt = phase2Call.find((p) => (p as { name?: string }).name === "database") as {
      choices: unknown[];
    };
    expect(dbPrompt.choices).toHaveLength(14);

    const code = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(code).toContain("createTursoDatabase");
  });
});
