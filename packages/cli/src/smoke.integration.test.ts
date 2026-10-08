/**
 * Smoke test of the *built* artifacts, gated on `RUN_SMOKE=1` (CI runs it after
 * the build). Unit tests exercise sources; this exercises what users get:
 *
 * - the built CLI launched through a `.bin`-style symlink, as `npx` does
 * - a freshly scaffolded server project: type-checks, boots, serves, shuts down
 *
 * Workspace packages are symlinked into the generated project instead of
 * installed from npm, so it runs against the code in this checkout.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("prompts", () => ({ default: vi.fn() }));

import prompts from "prompts";
import { runServerInit } from "./commands/server/init.ts";

const enabled = process.env["RUN_SMOKE"] === "1";
const repoRoot = resolve(import.meta.dirname, "../../..");
const scratchRoot = join(repoRoot, ".tmp");
/** Node used for the spawned CLI and server (`SMOKE_NODE`), default: the one running vitest. */
const nodeBin = process.env["SMOKE_NODE"] || process.execPath;
const cliDist = join(repoRoot, "packages/cli/dist/index.js");
const tsc = join(repoRoot, "node_modules/.bin/tsc");
const honoNodeServer = join(repoRoot, "node_modules/@hono/node-server");

/** Scratch dir inside the repo so generated projects resolve root node_modules (@types/node). */
function makeScratch(prefix: string): string {
  mkdirSync(scratchRoot, { recursive: true });
  return mkdtempSync(join(scratchRoot, prefix));
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => {
        resolvePort(port);
      });
    });
  });
}

async function waitForOk(
  url: string,
  child: ChildProcess,
  timeoutMs: number,
  readLog: () => string,
): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}\n${readLog()}`);
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- poll until the server answers
      return await fetch(url);
    } catch {
      // oxlint-disable-next-line no-await-in-loop -- poll interval
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`no response from ${url} within ${timeoutMs} ms`);
}

describe.skipIf(!enabled)("runtime under test", () => {
  it("is the Node major the run asked for (SMOKE_NODE_MAJOR)", () => {
    const expected = process.env["SMOKE_NODE_MAJOR"];
    const actual = spawnSync(nodeBin, ["--version"], { encoding: "utf8" }).stdout.trim();
    if (expected) {
      expect(actual.startsWith(`v${expected}.`)).toBe(true);
    }
    expect(actual).toMatch(/^v\d+\./u);
  });
});

describe.skipIf(!enabled)("built CLI", () => {
  it("runs when launched through a .bin symlink (npx)", () => {
    expect(existsSync(cliDist)).toBe(true);
    const dir = makeScratch("smoke-bin-");
    const link = join(dir, "storyshelf");
    symlinkSync(cliDist, link);

    const help = spawnSync(nodeBin, [link, "-h"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: storyshelf");

    const version = spawnSync(nodeBin, [link, "--version"], { encoding: "utf8" });
    const pkg = JSON.parse(readFileSync(join(repoRoot, "packages/cli/package.json"), "utf8")) as {
      version: string;
    };
    expect(version.stdout.trim()).toBe(pkg.version);
  });
});

describe.skipIf(!enabled)("scaffolded server project", () => {
  let dir = "";
  let server: ChildProcess | undefined;
  let log = "";

  beforeAll(async () => {
    dir = makeScratch("smoke-scaffold-");
    vi.stubGlobal("__PKG_VERSION__", "0.0.0");
    vi.mocked(prompts).mockResolvedValue({
      name: "smoke-server",
      dir,
      deployTarget: "local",
      database: "sqlite",
      storage: "local",
      auth: "none",
      git: "none",
      queue: "memory",
      docker: false,
    });
    await runServerInit({});

    // Link the workspace packages (and the one runtime dep outside them).
    const scope = join(dir, "node_modules/@storyshelf");
    mkdirSync(scope, { recursive: true });
    for (const name of ["app", "core", "db-sqlite", "storage-local", "runner-playwright"]) {
      symlinkSync(join(repoRoot, "packages", name), join(scope, name));
    }
    mkdirSync(join(dir, "node_modules/@hono"), { recursive: true });
    symlinkSync(honoNodeServer, join(dir, "node_modules/@hono/node-server"));
  }, 60_000);

  afterAll(() => {
    server?.kill("SIGKILL");
  });

  it("generates src/index.ts, tsconfig.json and no root server.ts", () => {
    expect(existsSync(join(dir, "src/index.ts"))).toBe(true);
    expect(existsSync(join(dir, "tsconfig.json"))).toBe(true);
    expect(existsSync(join(dir, "server.ts"))).toBe(false);
  });

  it("type-checks against the built packages", () => {
    const result = spawnSync(tsc, ["-p", "tsconfig.json"], { cwd: dir, encoding: "utf8" });
    expect(result.stdout + result.stderr).toBe("");
    expect(result.status).toBe(0);
  }, 120_000);

  it("boots, serves HTML and vendored assets, and shuts down cleanly", async () => {
    const port = await freePort();
    server = spawn(nodeBin, ["src/index.ts"], {
      cwd: dir,
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: join(dir, "data"),
        SECRET: "smoke-test-secret-smoke-test-secret",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (chunk: Buffer) => (log += chunk.toString()));
    server.stderr?.on("data", (chunk: Buffer) => (log += chunk.toString()));

    const home = await waitForOk(`http://127.0.0.1:${port}/`, server, 30_000, () => log);
    expect(home.status).toBe(200);
    const htmx = await fetch(`http://127.0.0.1:${port}/assets/htmx.js`);
    expect(htmx.status).toBe(200);
    expect((await htmx.text()).length).toBeGreaterThan(10_000);

    const exited = new Promise<number | null>((done) => {
      server?.once("exit", (code) => {
        done(code);
      });
    });
    server.kill("SIGTERM");
    await exited;
    expect(log).not.toContain("database is not open");
  }, 60_000);
});
