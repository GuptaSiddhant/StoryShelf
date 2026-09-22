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

describe("runServerInit", () => {
  it("scaffolds server.ts with in-memory queue", async () => {
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

    expect(existsSync(join(dir, "server.ts"))).toBe(true);
    const code = readFileSync(join(dir, "server.ts"), "utf8");
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
    // First prompts call returns main answers with queue=sqs, second returns includeWorker=true
    vi.mocked(prompts)
      .mockResolvedValueOnce({
        name: "my-server",
        dir: "./my-server",
        database: "turso",
        storage: "s3",
        auth: "none",
        git: "none",
        queue: "sqs",
        docker: false,
      })
      .mockResolvedValueOnce({ includeWorker: true });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    expect(existsSync(join(dir, "server.ts"))).toBe(true);
    expect(existsSync(join(dir, "worker.ts"))).toBe(true);
    const serverCode = readFileSync(join(dir, "server.ts"), "utf8");
    expect(serverCode).toContain("createSqsCaptureQueue");
    expect(serverCode).not.toContain("createPlaywrightCaptureRunner");
    const workerCode = readFileSync(join(dir, "worker.ts"), "utf8");
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
    vi.mocked(prompts)
      .mockResolvedValueOnce({
        name: "my-server",
        dir: "./my-server",
        database: "sqlite",
        storage: "local",
        auth: "none",
        git: "none",
        queue: "sqs",
        docker: false,
      })
      .mockResolvedValueOnce({ includeWorker: false });

    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }

    expect(existsSync(join(dir, "server.ts"))).toBe(true);
    expect(existsSync(join(dir, "worker.ts"))).toBe(false);
  });

  it("generates slim Dockerfile and worker compose when with worker and docker", async () => {
    vi.mocked(prompts)
      .mockResolvedValueOnce({
        name: "my-server",
        dir: "./my-server",
        database: "postgres",
        storage: "local",
        auth: "none",
        git: "none",
        queue: "sqs",
        docker: true,
      })
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
    const code = readFileSync(join(dir, "server.ts"), "utf8");
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

    const serverCode = readFileSync(join(dir, "server.ts"), "utf8");
    expect(serverCode).toContain("createPostgresDatabase");
    expect(serverCode).toContain("createS3Storage");
    expect(serverCode).toContain("createSqsCaptureQueue");
    expect(serverCode).toContain("cognitoPreset");
    expect(existsSync(join(dir, "worker.ts"))).toBe(true);
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

    const serverCode = readFileSync(join(dir, "server.ts"), "utf8");
    expect(serverCode).toContain("createPostgresDatabase");
    expect(serverCode).toContain("createAzureStorage");
    expect(serverCode).toContain("createAzureServiceBusQueue");
    expect(serverCode).toContain("AZURE_SERVICE_BUS_CONNECTION");
    expect(serverCode).not.toContain("cognitoPreset");
    expect(serverCode).toContain("OIDC_ISSUER");
    expect(existsSync(join(dir, "worker.ts"))).toBe(true);
    const workerCode = readFileSync(join(dir, "worker.ts"), "utf8");
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

    const serverCode = readFileSync(join(dir, "server.ts"), "utf8");
    expect(serverCode).toContain("createPostgresDatabase");
    expect(serverCode).toContain("createGcsStorage");
    expect(serverCode).toContain("createGcpPubSubQueue");
    expect(serverCode).toContain("GOOGLE_CLOUD_PROJECT");
    expect(serverCode).not.toContain("cognitoPreset");
    expect(existsSync(join(dir, "worker.ts"))).toBe(true);
    const workerCode = readFileSync(join(dir, "worker.ts"), "utf8");
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
    const code = readFileSync(join(dir, "server.ts"), "utf8");
    expect(code).toContain("createOAuthAuth");
    expect(code).toContain("OIDC_ISSUER");
    expect(code).not.toContain("cognitoPreset");
    expect(existsSync(join(dir, "terraform"))).toBe(false);
  });

  it("adds docker scripts for the docker target", async () => {
    vi.mocked(prompts).mockResolvedValue({
      name: "my-server",
      dir: "./my-server",
      deployTarget: "docker",
      database: "sqlite",
      storage: "local",
      auth: "none",
      git: "none",
      queue: "memory",
      docker: true,
    });
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runServerInit({});
    } finally {
      process.chdir(cwd);
    }
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["docker:up"]).toBeDefined();
    expect(pkg.scripts["docker:down"]).toBeDefined();
    expect(pkg.scripts["infra:plan"]).toBeUndefined();
  });
});
