/**
 * Smoke test of the *built* artifacts, gated on `RUN_SMOKE=1` (CI runs it after the build): a freshly
 * scaffolded server project type-checks, boots (`storyshelf-server serve`), serves, shuts down.
 *
 * The workspace packages the generated package.json declares (and only those) are symlinked into the
 * project instead of installed from npm, so it runs against the code in this checkout and a missing
 * dependency fails.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("prompts", () => ({ default: vi.fn() }));

import prompts from "prompts";
import { runInit } from "./init.ts";

const enabled = process.env["RUN_SMOKE"] === "1";
const repoRoot = resolve(import.meta.dirname, "../../..");
const scratchRoot = join(repoRoot, ".tmp");
/** The server runs under the same Node as the test (the pipeline's default Node). */
const nodeBin = process.execPath;
const tsc = join(repoRoot, "node_modules/.bin/tsc");

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
      docker: false,
    });
    await runInit({});

    // Link exactly the workspace packages the scaffold declares (and the one runtime dep outside them).
    const scope = join(dir, "node_modules/@storyshelf");
    mkdirSync(scope, { recursive: true });
    const { dependencies } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    for (const dep of Object.keys(dependencies)) {
      if (dep.startsWith("@storyshelf/")) {
        const name = dep.slice("@storyshelf/".length);
        symlinkSync(join(repoRoot, "packages", name), join(scope, name));
      }
    }
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
    server = spawn(nodeBin, ["node_modules/@storyshelf/app/dist/bin.mjs", "serve"], {
      cwd: dir,
      env: {
        ...process.env,
        PORT: String(port),
        SHELF_DATA_DIR: join(dir, "data"),
        SHELF_SECRET: "smoke-test-secret-smoke-test-secret",
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
