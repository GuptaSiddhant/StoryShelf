import { describe, expect, it } from "vitest";
import { githubAppManifest, manifestFormUrl, webHost } from "./manifest.ts";

const URLS = {
  name: "StoryShelf (shelf.example.com)",
  homepageUrl: "https://shelf.example.com/",
  redirectUrl: "https://shelf.example.com/admin/git/github/return",
  webhookUrl: "https://shelf.example.com/admin/git/github/no-webhooks",
};

describe("githubAppManifest", () => {
  it("asks for a private App with Checks write, Contents read and the comment by default", () => {
    expect(githubAppManifest(URLS)).toEqual({
      name: URLS.name,
      url: URLS.homepageUrl,
      description: expect.any(String) as string,
      public: false,
      redirect_url: URLS.redirectUrl,
      hook_attributes: { url: URLS.webhookUrl, active: false },
      default_permissions: { checks: "write", contents: "read", pull_requests: "write" },
      default_events: [],
    });
  });

  it("adds commit statuses and drops the comment when chosen", () => {
    const manifest = githubAppManifest({
      ...URLS,
      posts: { pullRequests: false, statuses: true },
    });
    expect(manifest.default_permissions).toEqual({
      checks: "write",
      contents: "read",
      statuses: "write",
    });
  });

  it("refuses a non-http URL", () => {
    expect(() => githubAppManifest({ ...URLS, redirectUrl: "javascript:alert(1)" })).toThrow(
      /http/u,
    );
  });
});

describe("manifestFormUrl", () => {
  it("posts to the personal or organization form on github.com with the state", () => {
    expect(manifestFormUrl({ state: "s1" })).toBe("https://github.com/settings/apps/new?state=s1");
    expect(manifestFormUrl({ state: "s1", organization: "acme-co" })).toBe(
      "https://github.com/organizations/acme-co/settings/apps/new?state=s1",
    );
  });

  it("posts to a GitHub Enterprise Server's own host", () => {
    expect(
      manifestFormUrl({ state: "s", apiUrl: "https://ghes.example.com/api/v3", organization: "" }),
    ).toBe("https://ghes.example.com/settings/apps/new?state=s");
  });

  it("refuses an organization name that is not one", () => {
    expect(() => manifestFormUrl({ state: "s", organization: "../evil" })).toThrow(/organization/u);
  });
});

describe("webHost", () => {
  it("maps API bases to their web origins", () => {
    expect(webHost()).toBe("https://github.com");
    expect(webHost("https://api.github.com/")).toBe("https://github.com");
    expect(webHost("https://ghes.example.com/api/v3")).toBe("https://ghes.example.com");
  });
});
