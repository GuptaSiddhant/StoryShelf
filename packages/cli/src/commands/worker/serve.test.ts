import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveWorkerFile,
  runWorkerServe,
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
  dir = mkdtempSync(join(tmpdir(), "storyshelf-worker-serve-"));
  savedExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.exitCode = savedExitCode;
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveWorkerFile", () => {
  it("prefers worker.ts over later fallbacks", async () => {
    writeFileSync(join(dir, "worker.ts"), "// ts");
    writeFileSync(join(dir, "worker.js"), "// js");
    writeFileSync(join(dir, "index.mjs"), "// mjs");
    await expect(resolveWorkerFile(dir)).resolves.toBe(join(dir, "worker.ts"));
  });

  it.each([["worker.js"], ["worker.mjs"], ["index.ts"], ["index.js"], ["index.mjs"]])(
    "falls back to %s",
    async (name) => {
      writeFileSync(join(dir, name), "// entry");
      await expect(resolveWorkerFile(dir)).resolves.toBe(join(dir, name));
    },
  );

  it("directs to worker init when nothing matches", async () => {
    await expect(resolveWorkerFile(dir)).rejects.toThrow("worker init");
  });
});

describe("runWorkerServe", () => {
  it("spawns node with transform flag for TypeScript entries", async () => {
    writeFileSync(join(dir, "worker.ts"), "// entry");
    const { calls, spawn } = stubSpawn(0);
    await runWorkerServe({ dir }, { spawnProcess: spawn });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe(process.execPath);
    expect(calls[0]?.args).toEqual(["--experimental-transform-types", join(dir, "worker.ts")]);
    expect(calls[0]?.options.cwd).toBe(dir);
  });

  it("spawns plain node for JavaScript and sets env overrides", async () => {
    writeFileSync(join(dir, "worker.mjs"), "// entry");
    const { calls, spawn } = stubSpawn(0);
    await runWorkerServe(
      { dir, queueUrl: "https://sqs.example.com/q", concurrency: "3" },
      { spawnProcess: spawn },
    );
    expect(calls[0]?.args).toEqual([join(dir, "worker.mjs")]);
    expect(calls[0]?.options.env["QUEUE_URL"]).toBe("https://sqs.example.com/q");
    expect(calls[0]?.options.env["WORKER_CONCURRENCY"]).toBe("3");
  });

  it("throws when child exits non-zero", async () => {
    writeFileSync(join(dir, "worker.js"), "// entry");
    const { spawn } = stubSpawn(2);
    await expect(runWorkerServe({ dir }, { spawnProcess: spawn })).rejects.toThrow("code 2");
  });

  it("throws for missing worker entry", async () => {
    const { spawn } = stubSpawn(0);
    await expect(runWorkerServe({ dir }, { spawnProcess: spawn })).rejects.toThrow("worker init");
  });
});
