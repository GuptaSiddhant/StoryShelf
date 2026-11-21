import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadStorybookConfig } from "../config.ts";
import { runCreate } from "./create.ts";

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

  it("exits 1 without a token when the server has sign-in on", async () => {
    setupProject();
    mockFetch(() => ({ status: "ok", auth: true }));
    await runCreate({ url: "https://shelf.example.com", name: "demo", cwd: dir });
    expect(process.exitCode).toBe(1);
  });

  it("exits 1 without a token when the server cannot be probed", async () => {
    setupProject();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => await Promise.reject(new TypeError("fetch failed"))),
    );
    await runCreate({ url: "https://shelf.example.com", name: "demo", cwd: dir });
    expect(process.exitCode).toBe(1);
  });
});

describe("runCreate without a token", () => {
  it("creates the project and token when the server reports sign-in off", async () => {
    setupProject();
    const auth: (string | undefined)[] = [];
    mockFetch((url: string, init?: RequestInit) => {
      auth.push((init?.headers as Record<string, string> | undefined)?.["Authorization"]);
      if (url.endsWith("/health")) {
        return { status: "ok", auth: false };
      }
      return url.endsWith("/tokens") ? { token: "ci-token" } : { slug: "demo" };
    });

    await runCreate({ url: "https://shelf.example.com", name: "demo", cwd: dir });

    expect(process.exitCode).toBeUndefined();
    expect(auth).toEqual([undefined, undefined, undefined, undefined]);
    await expect(loadStorybookConfig(dir)).resolves.toEqual({
      slug: "demo",
      url: "https://shelf.example.com",
    });
  });

  it("says the project exists and what to do when the token call fails", async () => {
    setupProject();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        await Promise.resolve();
        if (url.endsWith("/tokens")) {
          return Response.json({ error: { message: "nope" } }, { status: 401 });
        }
        return Response.json(url.endsWith("/health") ? { auth: false } : { slug: "demo" });
      }),
    );
    const errors: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      errors.push(String(chunk));
      return true;
    });

    await runCreate({ url: "https://shelf.example.com", name: "demo", cwd: dir });

    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toContain('Project "demo" was created');
    expect(errors.join("\n")).toContain("Next:");
    await expect(loadStorybookConfig(dir)).resolves.toMatchObject({ slug: "demo" });
  });
});

describe("runCreate with sign-in on", () => {
  it("creates the project but mints no token, and points at the project's page", async () => {
    setupProject();
    const seen: string[] = [];
    mockFetch((url: string) => {
      seen.push(url);
      return url.endsWith("/health") ? { status: "ok", auth: true } : { slug: "demo" };
    });
    let out = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });

    await runCreate({
      url: "https://shelf.example.com/",
      name: "demo",
      token: "admin-token",
      cwd: dir,
    });

    expect(process.exitCode).toBeUndefined();
    expect(seen.some((url) => url.endsWith("/tokens"))).toBe(false);
    expect(out).toContain("https://shelf.example.com/projects/demo/builds");
    expect(out).toContain("SHELF_TOKEN");
    expect(out).not.toContain("CI token:");
    await expect(loadStorybookConfig(dir)).resolves.toMatchObject({ slug: "demo" });
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
      "https://shelf.example.com/api/v1/health",
      "https://shelf.example.com/api/v1/projects/demo/tokens",
    ]);
    await expect(loadStorybookConfig(dir)).resolves.toEqual({
      slug: "demo",
      url: "https://shelf.example.com",
    });
  });
});
