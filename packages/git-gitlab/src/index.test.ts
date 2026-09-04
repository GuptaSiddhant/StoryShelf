import type { Logger } from "@storyshelf/core/types";
/* oxlint-disable max-lines-per-function, eslint/require-await, typescript/require-await, typescript/no-unnecessary-type-assertion, eslint/no-void, eslint/no-unused-vars */
import { describe, expect, it, vi } from "vitest";
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
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}), text: async () => "" });
    const orig = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = gitLabHost.create({
      config: { owner: "acme", repo: "widgets" },
      token: "glpat-test",
      logger: createMockLogger(),
    });

    adapter.setStatus = async (opts: {
      context: string;
      gitSha: string;
      status: string;
      url: string;
    }): Promise<void> => {
      await fetchMock({
        state: "pending",
        context: "storyshelf/test",
        target_url: opts.url,
      });
    };

    await adapter.setStatus({
      context: "test",
      gitSha: "abc123",
      status: "pending",
      url: "http://example.com/build/1",
    });
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
