import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUpload } from "./upload.ts";

let dir: string;

function baseOptions(): {
  url: string;
  slug: string;
  token: string;
  sha: string;
  branch: string;
  cwd: string;
} {
  return {
    url: "https://shelf.example.com",
    slug: "demo",
    token: "ci-token",
    sha: "abc123",
    branch: "main",
    cwd: dir,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-cli-upload-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("runUpload validation", () => {
  function throwsWithout(field: string, partial: Record<string, string>, message: string): void {
    it(`throws without ${field}`, async () => {
      await expect(runUpload({ ...partial, cwd: dir })).rejects.toThrow(message);
    });
  }  const cases: { field: string; partial: Record<string, string>; message: string }[] = [
    { field: "url", partial: { slug: "demo", token: "t", sha: "s", branch: "b" }, message: "--url is required" },
    { field: "slug", partial: { url: "u", token: "t", sha: "s", branch: "b" }, message: "--slug is required" },
    { field: "token", partial: { url: "u", slug: "s", sha: "s", branch: "b" }, message: "--token is required" },
    { field: "sha", partial: { url: "u", slug: "s", token: "t", branch: "b" }, message: "--sha is required" },
    { field: "branch", partial: { url: "u", slug: "s", token: "t", sha: "s" }, message: "--branch is required" },
  ];
  for (const { field, partial, message } of cases) {
    throwsWithout(field, partial, message);
  }

  it("skips silently when the branch matches skip", async () => {
    const fetched = vi.fn(async (): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
      await Promise.resolve();
      return {
        ok: true,
        json: async (): Promise<unknown> => {
          await Promise.resolve();
          return { id: "b1" };
        },
      };
    });
    vi.stubGlobal("fetch", fetched);
    await runUpload({ ...baseOptions(), branch: "dependabot/npm", skip: "dependabot/*" });
    expect(fetched).not.toHaveBeenCalled();
  });
});

describe("runUpload success", () => {
  it("zips the build dir and posts multipart form data", async () => {
    const buildDir = join(dir, "storybook-static");
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(join(buildDir, "index.json"), JSON.stringify({ v: 5, entries: {} }));
    writeFileSync(join(buildDir, "iframe.html"), "<html></html>");

    let posted: FormData | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        await Promise.resolve();
        posted = init?.body as FormData;
        return {
          ok: true,
          status: 202,
          text: async (): Promise<string> => {
            await Promise.resolve();
            return "";
          },
          json: async (): Promise<unknown> => {
            await Promise.resolve();
            return { id: "b1" };
          },
        };
      }),
    );

    await runUpload({ ...baseOptions(), buildDir: "storybook-static" });

    expect(posted).toBeInstanceOf(FormData);
    expect(posted?.get("gitSha")).toBe("abc123");
    expect(posted?.get("gitBranch")).toBe("main");
    const zip = posted?.get("zip");
    expect(zip).toBeInstanceOf(Blob);
    expect((zip as Blob).size).toBeGreaterThan(0);
  });
});
