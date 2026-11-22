/**
 * Pins what `create-storyshelf` writes and prints for a spread of presets: every file of the
 * scaffold (path, size, SHA-256) and the console output, so a refactor of `init.ts` can be shown
 * byte-identical. A change to a template or a pin shows up here and is a decision, not an accident.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("prompts", () => ({
  default: vi.fn(),
}));

// The runner is read from the environment (npm_config_user_agent); pin it so the output is the same everywhere.
vi.mock("./runner.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./runner.ts")>()),
  detectPackageRunner: async (): Promise<"npm"> => await Promise.resolve("npm"),
}));

vi.mock("./output.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./output.ts")>();
  // A fixed clock and a non-terminal reporter, whatever the terminal, `CI` and `NO_COLOR` are.
  return {
    ...original,
    createReporter: (): ReturnType<typeof original.createReporter> =>
      original.createReporter({ interactive: false, now: () => 0 }),
  };
});

import prompts from "prompts";
import { runInit } from "./init.ts";

vi.mock("./manifest.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./manifest.ts")>()),
  // Pin the version so a release does not churn the snapshots; the peer ranges stay the manifest's.
  ownVersion: () => "0.3.2",
}));

const BASE = {
  name: "my-server",
  dir: "./my-server",
  database: "sqlite",
  storage: "local",
  auth: "none",
  git: "none",
  docker: false,
} as const;

const DATABASES = [
  "sqlite",
  "turso",
  "better-sqlite3",
  "bun-sqlite",
  "d1",
  "postgres",
  "pg",
  "neon",
  "neon-http",
  "vercel",
  "pglite",
  "mysql",
  "planetscale",
  "tidb",
] as const;

const PRESETS: Record<string, Record<string, unknown>> = {
  ...Object.fromEntries(DATABASES.map((database) => [`database ${database}`, { database }])),
  "storage s3": { storage: "s3" },
  "storage azure": { storage: "azure" },
  "storage gcs": { storage: "gcs" },
  "auth password": { auth: "password" },
  "auth oauth": { auth: "oauth" },
  "git on": { git: "git" },
  notifications: { notifications: true },
  "notifications with password auth": { notifications: true, auth: "password" },
  "notifications with oauth": { notifications: true, auth: "oauth" },
  design: { design: true },
  observability: { observability: true },
  "everything on": {
    database: "postgres",
    storage: "s3",
    auth: "password",
    git: "git",
    notifications: true,
    design: true,
    observability: true,
  },
  "docker single container": { deployTarget: "docker", docker: true },
  "docker with postgres compose": { deployTarget: "docker", docker: true, database: "postgres" },
  "docker advanced adapters": {
    deployTarget: "docker",
    docker: true,
    advancedAdapters: true,
    database: "mysql",
  },
  "legacy docker flag": { docker: true },
  "local with advanced adapters": {
    deployTarget: "local",
    advancedAdapters: true,
    database: "tidb",
  },
};

let tmpRoot = "";
let written = "";

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "storyshelf-init-snapshot-"));
  vi.mocked(prompts).mockReset();
  written = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
    written += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
    written += `[stderr] ${String(chunk)}`;
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(tmpRoot, { recursive: true, force: true });
});

function filesUnder(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .toSorted();
}

/** Path, size and SHA-256 of every scaffolded file. */
function fingerprint(root: string): string[] {
  return filesUnder(root).map((path) => {
    const bytes = readFileSync(join(root, path));
    const hash = createHash("sha256").update(bytes).digest("hex");
    return `${path} ${statSync(join(root, path)).size} ${hash}`;
  });
}

async function scaffold(answers: Record<string, unknown>): Promise<void> {
  vi.mocked(prompts).mockResolvedValue({ ...BASE, ...answers });
  const cwd = process.cwd();
  process.chdir(tmpRoot);
  try {
    await runInit({});
  } finally {
    process.chdir(cwd);
  }
}

describe("create-storyshelf output", () => {
  it.each(Object.entries(PRESETS))("is unchanged for %s", async (_name, answers) => {
    await scaffold(answers);
    const output = written.replaceAll(tmpRoot, "<tmp>").replaceAll(/\/private(?=<tmp>)/gu, "");
    expect({ files: fingerprint(join(tmpRoot, "my-server")), output }).toMatchSnapshot();
  });

  it("writes nothing and says so when the name is missing", async () => {
    vi.mocked(prompts).mockResolvedValue({});
    const cwd = process.cwd();
    process.chdir(tmpRoot);
    try {
      await runInit({});
    } finally {
      process.chdir(cwd);
    }
    expect(filesUnder(tmpRoot)).toEqual([]);
    expect(written).toContain("[stderr] Cancelled.\n");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
