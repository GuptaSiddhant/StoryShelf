import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConnection } from "./connection.ts";
import { runDoctor } from "./doctor.ts";

let dir: string;
let savedExitCode: typeof process.exitCode;

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

function setupStorybook(): void {
  mkdirSync(join(dir, ".storybook"), { recursive: true });
  writeFileSync(join(dir, ".storybook", "main.ts"), "export default {};\n");
}

function seedValidOutput(): void {
  const outDir = join(dir, "storybook-static");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "index.json"), "{}");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-doctor-"));
  savedExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveConnection", () => {
  it("throws without a url", async () => {
    await expect(resolveConnection({ slug: "demo", token: "t", cwd: dir })).rejects.toThrow(
      "--url is required",
    );
  });

  it("throws without a slug", async () => {
    await expect(
      resolveConnection({ url: "https://shelf.example.com", token: "t", cwd: dir }),
    ).rejects.toThrow("--slug is required");
  });

  it("throws without a token", async () => {
    await expect(
      resolveConnection({ url: "https://shelf.example.com", slug: "demo", cwd: dir }),
    ).rejects.toThrow("--token is required");
  });

  it("resolves flags over the config file", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ slug: "file-slug", url: "https://file.example.com" }),
    );
    await expect(
      resolveConnection({ url: "https://flag.example.com", slug: "demo", token: "t", cwd: dir }),
    ).resolves.toEqual({
      url: "https://flag.example.com",
      slug: "demo",
      token: "t",
    });
  });
});

describe("runDoctor", () => {
  it("passes everything when setup, server, and output are ready", async () => {
    setupStorybook();
    seedValidOutput();
    mockFetch(() => ({ name: "Demo", slug: "demo" }));
    await runDoctor({
      url: "https://shelf.example.com",
      slug: "demo",
      token: "ci-token",
      cwd: dir,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("fails when storybook setup is missing", async () => {
    seedValidOutput();
    mockFetch(() => ({ slug: "demo" }));
    await runDoctor({
      url: "https://shelf.example.com",
      slug: "demo",
      token: "ci-token",
      cwd: dir,
    });
    expect(process.exitCode).toBe(1);
  });

  it("fails when connection details are missing", async () => {
    setupStorybook();
    seedValidOutput();
    await runDoctor({ cwd: dir });
    expect(process.exitCode).toBe(1);
  });

  it("fails when the server rejects the token", async () => {
    setupStorybook();
    seedValidOutput();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await Promise.resolve();
        return {
          ok: false,
          status: 403,
          text: async (): Promise<string> => {
            await Promise.resolve();
            return "forbidden";
          },
          json: async (): Promise<unknown> => {
            await Promise.resolve();
            return {};
          },
        };
      }),
    );
    await runDoctor({
      url: "https://shelf.example.com",
      slug: "demo",
      token: "bad",
      cwd: dir,
    });
    expect(process.exitCode).toBe(1);
  });

  it("warns but passes when the build output is missing", async () => {
    setupStorybook();
    mockFetch(() => ({ slug: "demo" }));
    await runDoctor({
      url: "https://shelf.example.com",
      slug: "demo",
      token: "ci-token",
      cwd: dir,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("fails when the build output lacks index.json", async () => {
    setupStorybook();
    mkdirSync(join(dir, "storybook-static"), { recursive: true });
    writeFileSync(join(dir, "storybook-static", "other.txt"), "x");
    mockFetch(() => ({ slug: "demo" }));
    await runDoctor({
      url: "https://shelf.example.com",
      slug: "demo",
      token: "ci-token",
      cwd: dir,
    });
    expect(process.exitCode).toBe(1);
  });

  it("warns about synthetic identity without git", async () => {
    setupStorybook();
    seedValidOutput();
    mockFetch(() => ({ name: "Demo", slug: "demo" }));
    const lines: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string): boolean => {
      lines.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      await runDoctor({
        url: "https://shelf.example.com",
        slug: "demo",
        token: "ci-token",
        cwd: dir,
      });
    } finally {
      process.stdout.write = write;
    }
    expect(lines.some((line) => line.includes("No git repository"))).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });
});
