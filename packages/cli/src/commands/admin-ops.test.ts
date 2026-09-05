import { afterEach, describe, expect, it, vi } from "vitest";
import { runPurge } from "./purge.ts";
import { runRetry } from "./retry.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runRetry", () => {
  it("retries the build against the server", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        await Promise.resolve();
        seen.push(url);
        return {
          ok: true,
          status: 200,
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
    await runRetry({ url: "https://shelf.example.com", slug: "demo", buildId: "b1" });
    expect(seen).toEqual(["https://shelf.example.com/api/v1/projects/demo/builds/b1/retry"]);
  });
});

describe("runPurge", () => {
  it("purges against the admin endpoint", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        await Promise.resolve();
        seen.push({ url, init });
        return {
          ok: true,
          status: 200,
          text: async (): Promise<string> => {
            await Promise.resolve();
            return "";
          },
          json: async (): Promise<unknown> => {
            await Promise.resolve();
            return { removedBuilds: 3, removedFiles: 12 };
          },
        };
      }),
    );
    await runPurge({ url: "https://shelf.example.com", token: "admin-token" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://shelf.example.com/api/v1/admin/purge");
  });
});
