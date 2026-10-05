import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../../index.ts";
import {
  resolveServerFile,
  runServerServe,
  type SpawnOptions,
  type SpawnProcess,
} from "./serve.ts";

let dir: string;
let savedExitCode: typeof process.exitCode;

interface SpawnCall {
  command: string;
  args: readonly string[];
  options: SpawnOptions;
}

function stubSpawn(code: number): { calls: SpawnCall[]; spawn: SpawnProcess } {
  const calls: SpawnCall[] = [];
  const spawn = async (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ): Promise<number> => {
    calls.push({ command, args, options });
    await Promise.resolve();
    return code;
  };
  return { calls, spawn };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-server-serve-"));
  savedExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.exitCode = savedExitCode;
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveServerFile", () => {
  it("prefers server.ts over later fallbacks", async () => {
    writeFileSync(join(dir, "server.ts"), "// ts");
    writeFileSync(join(dir, "server.js"), "// js");
    writeFileSync(join(dir, "index.mjs"), "// mjs");
    await expect(resolveServerFile(dir)).resolves.toBe(join(dir, "server.ts"));
  });

  it.each([["server.js"], ["server.mjs"], ["index.ts"], ["index.js"], ["index.mjs"]])(
    "falls back to %s",
    async (name) => {
      writeFileSync(join(dir, name), "// entry");
      await expect(resolveServerFile(dir)).resolves.toBe(join(dir, name));
    },
  );

  it("directs to server init when nothing matches", async () => {
    await expect(resolveServerFile(dir)).rejects.toThrow("server init");
  });
});

describe("runServerServe", () => {
  it("spawns node with the transform flag for TypeScript entries", async () => {
    writeFileSync(join(dir, "server.ts"), "// entry");
    const { calls, spawn } = stubSpawn(0);

    await runServerServe({ dir }, { spawnProcess: spawn });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe(process.execPath);
    expect(calls[0]?.args).toEqual(["--experimental-transform-types", join(dir, "server.ts")]);
    expect(calls[0]?.options.cwd).toBe(dir);
  });

  it("spawns plain node for JavaScript entries and sets PORT", async () => {
    writeFileSync(join(dir, "index.mjs"), "// entry");
    const { calls, spawn } = stubSpawn(0);

    await runServerServe({ dir, port: "4321" }, { spawnProcess: spawn });

    expect(calls[0]?.args).toEqual([join(dir, "index.mjs")]);
    expect(calls[0]?.options.env["PORT"]).toBe("4321");
  });

  it("throws when the child exits non-zero", async () => {
    writeFileSync(join(dir, "server.js"), "// entry");
    const { spawn } = stubSpawn(3);

    await expect(runServerServe({ dir }, { spawnProcess: spawn })).rejects.toThrow("code 3");
  });

  it("throws for a missing server entry", async () => {
    const { spawn } = stubSpawn(0);
    await expect(runServerServe({ dir }, { spawnProcess: spawn })).rejects.toThrow("server init");
  });
});

describe("server default command", () => {
  it("dispatches bare `server` to serve", async () => {
    const program = createProgram();
    program.exitOverride();
    await program.parseAsync(["node", "storyshelf", "server", "--dir", dir]);
    expect(process.exitCode).toBe(1);
  });
});
