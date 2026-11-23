import { describe, expect, it } from "vitest";
import { accountOf, postsOf } from "./git-admin.ts";

describe("accountOf", () => {
  it("names a GitHub App's owner and, on GitHub Enterprise Server, its host", () => {
    expect(accountOf({ provider: "github-app", apiBase: null, config: { owner: "acme" } })).toBe(
      "acme",
    );
    expect(
      accountOf({
        provider: "github-app",
        apiBase: "https://ghes.example.com/api/v3",
        config: { appId: "7" },
      }),
    ).toBe("App 7 on ghes.example.com");
  });

  it("names a GitLab token's group and host", () => {
    expect(
      accountOf({
        provider: "gitlab-token",
        apiBase: "https://gitlab.example.com",
        config: { group: "acme/web" },
      }),
    ).toBe("acme/web on gitlab.example.com");
    expect(accountOf({ provider: "gitlab-token", apiBase: null, config: {} })).toBe("gitlab.com");
  });
});

describe("postsOf", () => {
  it("always posts the gate, and the comment and statuses within the ceiling", () => {
    expect(postsOf({ provider: "github-app", config: {} })).toEqual([
      "check runs",
      "pull-request comment",
    ]);
    expect(
      postsOf({
        provider: "github-app",
        config: { posts: { pullRequests: false, statuses: true } },
      }),
    ).toEqual(["check runs", "commit statuses"]);
    expect(
      postsOf({ provider: "gitlab-token", config: { posts: { pullRequests: false } } }),
    ).toEqual(["commit statuses"]);
  });
});
