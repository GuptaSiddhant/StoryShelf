import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWhoami } from "./whoami.ts";

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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-whoami-"));
  savedExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("runWhoami", () => {
  it("prints the server and project for a valid token", async () => {
    const seen: string[] = [];
    mockFetch((url: string) => {
      seen.push(url);
      return { name: "Demo", slug: "demo" };
    });
    await runWhoami({
      url: "https://shelf.example.com",
      slug: "demo",
      token: "ci-token",
      cwd: dir,
    });
    expect(seen).toEqual(["https://shelf.example.com/api/v1/projects/demo"]);
    expect(process.exitCode).toBeUndefined();
  });

  it("falls back to the slug when the project has no name", async () => {
    mockFetch(() => ({}));
    await runWhoami({
      url: "https://shelf.example.com",
      slug: "demo",
      token: "ci-token",
      cwd: dir,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("throws without a url", async () => {
    await expect(runWhoami({ slug: "demo", token: "t", cwd: dir })).rejects.toThrow(
      "--url is required",
    );
  });

  it("propagates server errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await Promise.resolve();
        return {
          ok: false,
          status: 401,
          text: async (): Promise<string> => {
            await Promise.resolve();
            return "unauthorized";
          },
          json: async (): Promise<unknown> => {
            await Promise.resolve();
            return {};
          },
        };
      }),
    );
    await expect(
      runWhoami({ url: "https://shelf.example.com", slug: "demo", token: "bad", cwd: dir }),
    ).rejects.toThrow("(401)");
  });

  it("resolves connection from the config file", async () => {
    mkdirSync(join(dir, ".storybook"), { recursive: true });
    writeFileSync(
      join(dir, ".storybook", "storyshelf.json"),
      JSON.stringify({ slug: "demo", url: "https://shelf.example.com" }),
    );
    const seen: string[] = [];
    mockFetch((url: string) => {
      seen.push(url);
      return { slug: "demo" };
    });
    await runWhoami({ token: "ci-token", cwd: dir });
    expect(seen).toEqual(["https://shelf.example.com/api/v1/projects/demo"]);
  });
});
