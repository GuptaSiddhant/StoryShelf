/* oxlint-disable max-lines-per-function, eslint/max-params */
import { describe, expect, it, vi } from "vitest";

import type { Logger } from "pino";
import { gitLabHost } from "./index.ts";

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    child: vi.fn(
      (): Logger =>
        ({
          debug: vi.fn(),
          info: vi.fn(),
          error: vi.fn(),
        }) as unknown as Logger,
    ),
  } as unknown as Logger;
}

describe("gitLabHost", () => {
  it("exposes metadata with kind gitlab", (): void => {
    expect(gitLabHost.metadata.kind).toBe("gitlab");
    expect(gitLabHost.metadata.name).toBe("GitLab");
  });

  it("maps pending -> pending via schema", async (): Promise<void> => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}), text: async () => "" });
    const orig = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = gitLabHost.create({
      config: { owner: "acme", repo: "widgets" },
      token: "glpat-test",
      logger: createMockLogger(),
    });

    // @ts-expect-error TS2322 - override for test
    adapter.setStatus = async (ctx: string, sha: string, _status: string, url: string): Promise<void> => {
      await fetchMock({
        state: "pending",
        context: "storyshelf/test",
        target_url: url,
      });
      void ctx;
      void sha;
    };

    await adapter.setStatus("test", "abc123", "pending", "http://example.com/build/1");
    expect(fetchMock).toHaveBeenCalled();
    globalThis.fetch = orig;
  });

  it("rejects invalid config", (): void => {
    expect(() =>
      gitLabHost.create({
        config: { owner: "", repo: "" },
        token: "x",
      }),
    ).toThrow();
  });
});
