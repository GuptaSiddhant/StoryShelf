import { describe, expect, it } from "vitest";
import { linkChannel, postsComments } from "./link-channel.ts";

describe("linkChannel", () => {
  const row = {
    id: "l1",
    projectId: "p1",
    owner: "acme",
    repo: "web",
    prefix: "",
    hostRepositoryId: "9",
    installationId: null,
  } as Parameters<typeof linkChannel>[0];

  it("needs pins, and supports GitHub Apps and GitLab tokens only", () => {
    const github = { provider: "github-app" as const, apiBase: null, config: { appId: "1" } };
    expect(linkChannel(row, github, "k")).toBeNull();
    expect(linkChannel({ ...row, hostRepositoryId: null }, github, "k")).toBeNull();
    expect(
      linkChannel(
        { ...row, installationId: "3" },
        { ...github, apiBase: "https://ghes.example.com/api/v3" },
        "k",
      )?.config,
    ).toMatchObject({ apiUrl: "https://ghes.example.com/api/v3", installationId: "3" });
    expect(
      linkChannel(row, { provider: "other" as "github-app", apiBase: null, config: {} }, "k"),
    ).toBeNull();
  });
});

describe("postsComments", () => {
  it("allows the comment unless the ceiling says pull requests may not be written", () => {
    expect(postsComments({ config: {} })).toBe(true);
    expect(postsComments({ config: { posts: { pullRequests: true } } })).toBe(true);
    expect(postsComments({ config: { posts: { pullRequests: false } } })).toBe(false);
  });
});
