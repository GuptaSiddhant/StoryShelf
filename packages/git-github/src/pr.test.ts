import type { Octokit } from "@octokit/rest";
import type { CheckStatus } from "@storyshelf/core/adapter/git-host";
import { describe, expect, it, vi } from "vitest";
import { mapStatus } from "./mapper.ts";
import { findPrNumber } from "./pr.ts";

function stubOctokit(
  listPulls: (opts: { owner: string; repo: string; commit_sha: string }) => Promise<{ data: { number?: unknown }[] }>,
): Octokit {
  return {
    repos: {
      listPullRequestsAssociatedWithCommit: listPulls,
    },
  } as unknown as Octokit;
}

async function emptyPulls(): Promise<{ data: { number?: unknown }[] }> {
  await Promise.resolve();
  return { data: [] };
}

async function numberedPulls(...numbers: number[]): Promise<{ data: { number?: unknown }[] }> {
  await Promise.resolve();
  return { data: numbers.map((number) => ({ number })) };
}

describe("mapStatus", () => {
  it("maps the three check states to GitHub states", () => {
    expect(mapStatus("pending")).toBe("pending");
    expect(mapStatus("success")).toBe("success");
    expect(mapStatus("failure")).toBe("failure");
  });

  it("maps unknown states to error", () => {
    expect(mapStatus("bogus" as CheckStatus)).toBe("error");
  });
});

describe("findPrNumber", () => {
  it("returns the first associated PR number", async () => {
    const octokit = stubOctokit(async () => await numberedPulls(42, 43));
    await expect(
      findPrNumber({ octokit, owner: "acme", repo: "widgets", sha: "abc" }),
    ).resolves.toBe(42);
  });

  it("returns undefined when no PR is associated", async () => {
    const octokit = stubOctokit(emptyPulls);
    await expect(
      findPrNumber({ octokit, owner: "acme", repo: "widgets", sha: "abc" }),
    ).resolves.toBeUndefined();
  });

  it("returns undefined when the API throws", async () => {
    const octokit = stubOctokit(async () => {
      await Promise.resolve();
      throw new Error("rate limited");
    });
    await expect(
      findPrNumber({ octokit, owner: "acme", repo: "widgets", sha: "abc" }),
    ).resolves.toBeUndefined();
  });

  it("ignores non-numeric PR numbers", async () => {
    const octokit = stubOctokit(async () => {
      await Promise.resolve();
      return { data: [{ number: "42" }] };
    });
    await expect(
      findPrNumber({ octokit, owner: "acme", repo: "widgets", sha: "abc" }),
    ).resolves.toBeUndefined();
  });

  it("forwards owner, repo, and sha", async () => {
    const listPulls = vi.fn(emptyPulls);
    const octokit = stubOctokit(listPulls);
    await findPrNumber({ octokit, owner: "acme", repo: "widgets", sha: "abc123" });
    expect(listPulls).toHaveBeenCalledWith({ owner: "acme", repo: "widgets", commit_sha: "abc123" });
  });
});
