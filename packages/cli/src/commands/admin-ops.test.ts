import { afterEach, describe, expect, it, vi } from "vitest";
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
