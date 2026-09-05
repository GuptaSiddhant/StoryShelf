import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCreate } from "./create.ts";
import { loadStorybookConfig } from "../config.ts";

let dir: string;
let savedExitCode: typeof process.exitCode;

function setupProject(name: string | null = "my-sb"): void {
  mkdirSync(join(dir, ".storybook"), { recursive: true });
  writeFileSync(join(dir, ".storybook", "main.ts"), "export default {};\n");
  if (name) {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name }));
  }
}

function mockFetch(handler: (url: string, init?: RequestInit) => unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      await Promise.resolve();
      return {
        ok: true,
        status: 200,
        text: async (): Promise<string> => {
          await Promise.resolve();
          return "";
        },
        json: async (): Promise<unknown> => {
          await Promise.resolve();
          return handler(url, init);
        },
      };
    }),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-create-"));
  savedExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("runCreate validation", () => {
  it("fails without a storybook setup", async () => {
    await expect(runCreate({ cwd: dir })).rejects.toThrow(".storybook/main.* not found");
  });

  it("exits 1 without a url", async () => {
    setupProject();
    await runCreate({ name: "demo", token: "admin-token", cwd: dir });
    expect(process.exitCode).toBe(1);
  });

  it("exits 1 without a name", async () => {
    setupProject(null);
    await runCreate({ url: "https://shelf.example.com", token: "admin-token", cwd: dir });
    expect(process.exitCode).toBe(1);
  });

  it("exits 1 without a token", async () => {
    setupProject();
    await runCreate({ url: "https://shelf.example.com", name: "demo", cwd: dir });
    expect(process.exitCode).toBe(1);
  });
});

describe("runCreate success", () => {
  it("creates the project, mints a token, and writes the config", async () => {
    setupProject();
    const seen: string[] = [];
    mockFetch((url: string) => {
      seen.push(url);
      if (url.endsWith("/tokens")) {
        return { token: "ci-token-123" };
      }
      return { slug: "demo" };
    });

    await runCreate({
      url: "https://shelf.example.com",
      name: "demo",
      token: "admin-token",
      cwd: dir,
    });

    expect(process.exitCode).toBeUndefined();
    expect(seen).toEqual([
      "https://shelf.example.com/api/v1/projects",
      "https://shelf.example.com/api/v1/projects/demo/tokens",
    ]);
    await expect(loadStorybookConfig(dir)).resolves.toEqual({
      slug: "demo",
      url: "https://shelf.example.com",
    });
  });
});
