/* oxlint-disable max-lines-per-function, eslint/max-params */
import { describe, expect, it, vi } from "vitest";

import type { Logger } from "pino";
import { gitHubHost } from "./index.ts";

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

describe("gitHubHost", () => {
  it("maps pending -> pending", async (): Promise<void> => {
    const createStatus = vi.fn().mockResolvedValue({});

    const adapter = gitHubHost.create({
      config: { owner: "octocat", repo: "hello-world" },
      token: "ghp_test",
      logger: createMockLogger(),
    });

    // @ts-expect-error TS2322 - override for test
    adapter.setStatus = async (ctx: string, sha: string, _status: string, url: string): Promise<void> => {
      await createStatus({
        owner: "octocat",
        repo: "hello-world",
        sha,
        state: "pending",
        context: "storyshelf/test",
        target_url: url,
        description: "Visual tests pending",
      });
    };

    await adapter.setStatus("test", "abc123", "pending", "http://example.com/build/1");
    expect(createStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: "pending", context: "storyshelf/test" }),
    );
  });

  it("maps success -> success", async (): Promise<void> => {
    const createStatus = vi.fn().mockResolvedValue({});
    const adapter = gitHubHost.create({
      config: { owner: "octocat", repo: "hello-world" },
      token: "ghp_test",
      logger: createMockLogger(),
    });

    // @ts-expect-error TS2322 - override for test
    adapter.setStatus = async (ctx: string, sha: string, _status: string, url: string): Promise<void> => {
      await createStatus({
        owner: "octocat",
        repo: "hello-world",
        sha,
        state: "success",
        context: "storyshelf/test",
        target_url: url,
        description: "Visual tests passed",
      });
    };

    await adapter.setStatus("test", "abc123", "success", "http://example.com/build/1");
    expect(createStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: "success", context: "storyshelf/test" }),
    );
  });

  it("maps failure -> failure", async (): Promise<void> => {
    const createStatus = vi.fn().mockResolvedValue({});
    const adapter = gitHubHost.create({
      config: { owner: "octocat", repo: "hello-world" },
      token: "ghp_test",
      logger: createMockLogger(),
    });

    // @ts-expect-error TS2322 - override for test
    adapter.setStatus = async (ctx: string, sha: string, _status: string, url: string): Promise<void> => {
      await createStatus({
        owner: "octocat",
        repo: "hello-world",
        sha,
        state: "failure",
        context: "storyshelf/test",
        target_url: url,
        description: "Visual changes detected or tests failed",
      });
    };

    await adapter.setStatus("test", "abc123", "failure", "http://example.com/build/1");
    expect(createStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: "failure", context: "storyshelf/test" }),
    );
  });
});