/* oxlint-disable max-lines-per-function */
import { describe, expect, it, vi } from "vitest";

import type { Logger } from "@storyshelf/core/types";
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

    adapter.setStatus = async (opts: { context: string; gitSha: string; status: string; url: string }): Promise<void> => {
      await createStatus({
        owner: "octocat",
        repo: "hello-world",
        sha: opts.gitSha,
        state: "pending",
        context: "storyshelf/test",
        target_url: opts.url,
        description: "Visual tests pending",
      });
    };

    await adapter.setStatus({ context: "test", gitSha: "abc123", status: "pending", url: "http://example.com/build/1" });
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

    adapter.setStatus = async (opts: { context: string; gitSha: string; status: string; url: string }): Promise<void> => {
      await createStatus({
        owner: "octocat",
        repo: "hello-world",
        sha: opts.gitSha,
        state: "success",
        context: "storyshelf/test",
        target_url: opts.url,
        description: "Visual tests passed",
      });
    };

    await adapter.setStatus({ context: "test", gitSha: "abc123", status: "success", url: "http://example.com/build/1" });
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

    adapter.setStatus = async (opts: { context: string; gitSha: string; status: string; url: string }): Promise<void> => {
      await createStatus({
        owner: "octocat",
        repo: "hello-world",
        sha: opts.gitSha,
        state: "failure",
        context: "storyshelf/test",
        target_url: opts.url,
        description: "Visual changes detected or tests failed",
      });
    };

    await adapter.setStatus({ context: "test", gitSha: "abc123", status: "failure", url: "http://example.com/build/1" });
    expect(createStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: "failure", context: "storyshelf/test" }),
    );
  });
});