import type { CheckStatus } from "@storyshelf/core/adapter/git-host";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiBase, gitlabHeaders, projectId } from "./helpers.ts";
import { mapStatus } from "./mapper.ts";
import { findMrIid } from "./pr.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mapStatus", () => {
  it("maps the three check states to GitLab states", () => {
    expect(mapStatus("pending")).toBe("pending");
    expect(mapStatus("success")).toBe("success");
    expect(mapStatus("failure")).toBe("failed");
  });

  it("maps unknown states to failed", () => {
    expect(mapStatus("bogus" as CheckStatus)).toBe("failed");
  });
});

describe("helpers", () => {
  it("URL-encodes owner/repo as the project id", () => {
    expect(projectId("acme", "widgets")).toBe("acme%2Fwidgets");
  });

  it("defaults the API base to gitlab.com without trailing slashes", () => {
    expect(apiBase()).toBe("https://gitlab.com");
    expect(apiBase("https://git.example.com///")).toBe("https://git.example.com");
  });

  it("builds private-token auth headers", () => {
    expect(gitlabHeaders("secret")).toEqual({
      "PRIVATE-TOKEN": "secret",
      "content-type": "application/json",
    });
  });
});

function mockFetch(json: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await Promise.resolve();
      return {
        ok,
        json: async (): Promise<unknown> => {
          await Promise.resolve();
          return json;
        },
      };
    }),
  );
}

describe("findMrIid", () => {
  it("returns the first associated MR iid", async () => {
    mockFetch([{ iid: 7 }]);
    await expect(
      findMrIid({ owner: "acme", repo: "widgets", token: "t", sha: "abc" }),
    ).resolves.toBe(7);
  });

  it("returns undefined when no MR is associated", async () => {
    mockFetch([]);
    await expect(
      findMrIid({ owner: "acme", repo: "widgets", token: "t", sha: "abc" }),
    ).resolves.toBeUndefined();
  });

  it("returns undefined on HTTP errors", async () => {
    mockFetch({ message: "404" }, false);
    await expect(
      findMrIid({ owner: "acme", repo: "widgets", token: "t", sha: "abc" }),
    ).resolves.toBeUndefined();
  });

  it("returns undefined when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await Promise.resolve();
        throw new Error("network down");
      }),
    );
    await expect(
      findMrIid({ owner: "acme", repo: "widgets", token: "t", sha: "abc" }),
    ).resolves.toBeUndefined();
  });
});
