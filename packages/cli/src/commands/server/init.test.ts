import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

/**
 * `runServerInit` is the composition root: these tests run the whole command end to end. What each
 * stage writes is tested beside it in `init/` (prompts, codegen, package-json, writers, next-steps).
 */
describe("runServerInit", () => {
  it("scaffolds turso from the db-sqlite subpath with the libsql peer", async () => {
    vi.mocked(prompts).mockResolvedValue({
      name: "my-server",
      dir: "./my-server",
      database: "turso",
      storage: "local",
      auth: "none",
      git: "none",
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

  it("scaffolds one server that runs captures itself on the database queue", async () => {
    await scaffold({});
    expect(existsSync(join(dir, "src", "index.ts"))).toBe(true);
    expect(existsSync(join(dir, "src", "worker.ts"))).toBe(false);
    const code = readFileSync(join(dir, "src", "index.ts"), "utf8");
    expect(code).toContain("createShelfApp");
    expect(code).toContain("createPlaywrightCaptureRunner");
    expect(code).toContain("testing: { runner: captureRunner },");
    expect(code).toContain("scratchDir: dataDir,");
    expect(code).not.toMatch(/queue/iu);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/runner-playwright"]).toBeDefined();
    expect(Object.keys(pkg.dependencies).filter((name) => /queue|worker/u.test(name))).toEqual([]);
    expect(pkg.scripts["worker"]).toBeUndefined();
  });

  it("generates one Playwright image and a postgres-only compose for docker", async () => {
    await scaffold({ deployTarget: "docker", docker: true, database: "postgres" });
    expect(existsSync(join(dir, "Dockerfile"))).toBe(true);
    expect(existsSync(join(dir, "Dockerfile.worker"))).toBe(false);
    const compose = readFileSync(join(dir, "compose.yaml"), "utf8");
    expect(compose).toContain("postgres:");
    expect(compose).not.toContain("worker:");
    const dockerfile = readFileSync(join(dir, "Dockerfile"), "utf8");
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

  it("writes the AWS reference stack and forces postgres/s3", async () => {
    vi.mocked(prompts)
      .mockResolvedValueOnce({
        name: "my-server",
        dir: "./my-server",
        deployTarget: "aws",
        database: "sqlite",
        storage: "local",
        auth: "oauth",
        git: "git",
        docker: false,
      })
      .mockResolvedValueOnce({
        awsRegion: "eu-west-1",
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
    expect(serverCode).toContain("cognitoPreset");
    expect(serverCode).toContain("testing: { runner: captureRunner },");
    expect(existsSync(join(dir, "src", "worker.ts"))).toBe(false);
    expect(existsSync(join(dir, "terraform", "queue.tf"))).toBe(false);
    expect(existsSync(join(dir, "Dockerfile.worker"))).toBe(false);
    expect(existsSync(join(dir, "terraform", "database.tf"))).toBe(true);
    const databaseTf = readFileSync(join(dir, "terraform", "database.tf"), "utf8");
    expect(databaseTf).toContain("aws_db_instance");
    expect(databaseTf).not.toContain("dsql");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/db-postgres"]).toBeDefined();
    expect(pkg.scripts["infra:plan"]).toBeDefined();
    expect(pkg.scripts["infra:apply"]).toBeDefined();
    expect(pkg.scripts["docker:up"]).toBeUndefined();
  });

  it("writes the Azure reference stack and forces postgres/azure", async () => {
    vi.mocked(prompts)
      .mockResolvedValueOnce({
        name: "my-server",
        dir: "./my-server",
        deployTarget: "azure",
        database: "sqlite",
        storage: "local",
        auth: "oauth",
        git: "git",
        docker: false,
      })
      .mockResolvedValueOnce({
        azureLocation: "westeurope",
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
    expect(serverCode).not.toContain("cognitoPreset");
    expect(serverCode).toContain("OIDC_ISSUER");
    expect(serverCode).toContain("testing: { runner: captureRunner },");
    expect(existsSync(join(dir, "src", "worker.ts"))).toBe(false);
    expect(existsSync(join(dir, "terraform", "queue.tf"))).toBe(false);
    expect(existsSync(join(dir, "terraform", "terraform.tfvars.example"))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/db-postgres"]).toBeDefined();
    expect(pkg.dependencies["@storyshelf/storage-azure"]).toBeDefined();
    expect(pkg.dependencies["@azure/service-bus"]).toBeUndefined();
    expect(pkg.scripts["infra:plan"]).toBeDefined();
    expect(pkg.scripts["infra:apply"]).toBeDefined();
    expect(pkg.scripts["docker:up"]).toBeUndefined();
  });

  it("writes the GCP reference stack and forces postgres/gcs", async () => {
    vi.mocked(prompts)
      .mockResolvedValueOnce({
        name: "my-server",
        dir: "./my-server",
        deployTarget: "gcp",
        database: "sqlite",
        storage: "local",
        auth: "oauth",
        git: "git",
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
    expect(serverCode).toContain("testing: { runner: captureRunner },");
    expect(serverCode).not.toContain("cognitoPreset");
    expect(existsSync(join(dir, "src", "worker.ts"))).toBe(false);
    expect(existsSync(join(dir, "terraform", "queue.tf"))).toBe(false);
    expect(existsSync(join(dir, "terraform", "terraform.tfvars.example"))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies["@storyshelf/db-postgres"]).toBeDefined();
    expect(pkg.dependencies["@storyshelf/storage-gcs"]).toBeDefined();
    expect(pkg.dependencies["@google-cloud/pubsub"]).toBeUndefined();
    expect(pkg.scripts["infra:plan"]).toBeDefined();
    expect(pkg.scripts["infra:apply"]).toBeDefined();
    expect(pkg.scripts["docker:up"]).toBeUndefined();
  });
});
