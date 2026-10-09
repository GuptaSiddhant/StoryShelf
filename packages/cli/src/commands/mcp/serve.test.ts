import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SpawnOptions, SpawnProcess } from "../worker/serve.ts";
import { resolveMcpFile, runMcpServe } from "./serve.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-mcp-serve-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function stubSpawn(code: number): {
  calls: { args: readonly string[]; options: SpawnOptions }[];
  spawn: SpawnProcess;
} {
  const calls: { args: readonly string[]; options: SpawnOptions }[] = [];
  const spawn: SpawnProcess = async (_command, args, options) => {
    calls.push({ args, options });
    await Promise.resolve();
    return code;
  };
  return { calls, spawn };
}

function scaffold(): string {
  mkdirSync(join(dir, "src"));
  const file = join(dir, "src", "index.ts");
  writeFileSync(file, "");
  return file;
}

describe("resolveMcpFile", () => {
  it("finds src/index.ts", async () => {
    const file = scaffold();
    expect(await resolveMcpFile(dir)).toBe(file);
  });

  it("points at mcp init when nothing is found", async () => {
    await expect(resolveMcpFile(dir)).rejects.toThrow("storyshelf mcp init");
  });
});

describe("runMcpServe", () => {
  it("maps flags to STORYSHELF_* env and runs the entry", async () => {
    const file = scaffold();
    const { calls, spawn } = stubSpawn(0);
    await runMcpServe(
      { dir, url: "https://s.test", slug: "web", token: "t", port: "4000" },
      { spawnProcess: spawn },
    );
    expect(calls[0]?.args).toEqual([file]);
    expect(calls[0]?.options.env["STORYSHELF_URL"]).toBe("https://s.test");
    expect(calls[0]?.options.env["STORYSHELF_SLUG"]).toBe("web");
    expect(calls[0]?.options.env["STORYSHELF_TOKEN"]).toBe("t");
    expect(calls[0]?.options.env["PORT"]).toBe("4000");
  });

  it("throws on a non-zero exit", async () => {
    scaffold();
    await expect(runMcpServe({ dir }, { spawnProcess: stubSpawn(2).spawn })).rejects.toThrow(
      "code 2",
    );
  });
});
