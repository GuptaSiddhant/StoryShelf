import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  afterSetupMarker,
  instanceDir,
  recordingIo,
  tablesOf,
} from "./__fixtures__/instance-dir.ts";
import { SERVER_HELP } from "./help.ts";
import { runServerBin } from "./main.ts";

const APP = new URL("../index.tsx", import.meta.url).pathname;
const FIXTURE = new URL("__fixtures__/instance-app.ts", import.meta.url).pathname;

describe("runServerBin", () => {
  it("prints help with no command, loading no instance", async () => {
    const io = recordingIo();
    expect(await runServerBin([], io)).toBe(0);
    expect(io.stdout).toEqual([SERVER_HELP]);
  });

  it("answers --help with exit 0 and loads no adapter or instance", async () => {
    const io = recordingIo();
    expect(await runServerBin(["--help"], io, {})).toBe(0);
    expect(io.stdout).toEqual([SERVER_HELP]);
  });

  it("prints the version", async () => {
    const io = recordingIo();
    expect(await runServerBin(["--version"], io)).toBe(0);
    expect(io.stdout[0]).toMatch(/^\d+\.\d+\.\d+/u);
  });

  it("exits 2 on an argument error without loading anything", async () => {
    const io = recordingIo();
    expect(await runServerBin(["bogus"], io)).toBe(2);
    expect(io.stderr[0]).toContain('unknown command "bogus"');
  });

  it("exits 1 with the reason when a command fails", async () => {
    const io = recordingIo();
    expect(await runServerBin(["migrate", "--dir", "/nonexistent-dir"], io, {})).toBe(1);
    expect(io.stderr[0]).toContain("No instance module");
  });

  it("refuses a renamed variable before loading the instance, also one set in .env", async () => {
    const { dir, dataDir } = instanceDir();
    writeFileSync(join(dir, ".env"), "ADMIN_TOKEN=x\n");
    const io = recordingIo();
    expect(await runServerBin(["migrate", "--dir", dir], io, {})).toBe(1);
    expect(io.stderr[0]).toContain("SHELF_ADMIN_TOKEN");
    expect(tablesOf(dataDir)).toEqual([]);
  });

  it("loads .env for the factory, the shell's variables winning", async () => {
    const source = `import { defineShelfInstance } from ${JSON.stringify(APP)};
import { fixtureOptions } from ${JSON.stringify(FIXTURE)};
export default defineShelfInstance(async (env) => {
  if (env.SHELF_TEST_MARK !== "shell" || env.SHELF_TEST_FILE !== "file") throw new Error("env: " + env.SHELF_TEST_MARK + env.SHELF_TEST_FILE);
  return fixtureOptions("\${DATA}");
});
`;
    const { dir } = instanceDir({ source });
    writeFileSync(join(dir, ".env"), "SHELF_TEST_MARK=file\nSHELF_TEST_FILE=file\n");
    const io = recordingIo();
    expect(await runServerBin(["migrate", "--dir", dir], io, { SHELF_TEST_MARK: "shell" })).toBe(0);
  });

  it("stops serve with one line naming SHELF_PUBLIC_BASE_URL when it has no scheme (#1431)", async () => {
    const auth = fileURLToPath(import.meta.resolve("@storyshelf/auth"));
    const source = `import { createShelfAuth } from ${JSON.stringify(auth)};
import { defineShelfInstance } from ${JSON.stringify(APP)};
import { fixtureOptions } from ${JSON.stringify(FIXTURE)};
export default defineShelfInstance(async (env) => {
  const options = fixtureOptions("\${DATA}");
  const secret = "a-test-secret-that-is-long-enough-1234";
  const auth = createShelfAuth({ db: options.database, secret, baseURL: env.SHELF_PUBLIC_BASE_URL });
  return { ...options, auth: auth.adapter };
});
`;
    const { dir } = instanceDir({ source });
    const io = recordingIo();
    const env = { SHELF_PUBLIC_BASE_URL: "localhost:3000/" };
    expect(await runServerBin(["serve", "--dir", dir], io, env)).toBe(1);
    expect(io.stdout).toEqual([]);
    expect(io.stderr).toHaveLength(1);
    expect(io.stderr[0]).toMatch(
      /^storyshelf-server serve: .*SHELF_PUBLIC_BASE_URL.*http:\/\/localhost:3000$/u,
    );
    expect(io.stderr[0]).not.toContain("\n");
    expect(io.stderr[0]).not.toContain("BetterAuthError");
  });

  it("migrate runs the database setup only, then reports done", async () => {
    const { dir, dataDir } = instanceDir({ afterSetup: true });
    const io = recordingIo();
    expect(await runServerBin(["migrate", "--dir", dir], io, {})).toBe(0);
    expect(io.stdout[0]).toContain("Migrations");
    expect(tablesOf(dataDir)).toContain("schema_meta");
    // The afterSetup hook belongs to `serve` alone.
    expect(() => writeFileSync(afterSetupMarker(dataDir), "", { flag: "wx" })).not.toThrow();
  });
});
