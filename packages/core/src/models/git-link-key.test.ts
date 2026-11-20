import { describe, expect, it } from "vitest";
import { channelHoldsKey, connectionHost, linkKeyOf, sameLinkKey } from "./git-link-key.ts";

const row = (
  config: Record<string, unknown>,
  provider = "github",
  projectId: string | null = "p",
) =>
  ({ projectId, provider, config: JSON.stringify(config) }) as Parameters<
    typeof channelHoldsKey
  >[0];

describe("git link keys", () => {
  it("lower-cases host and repository and keeps an absent prefix empty", () => {
    expect(linkKeyOf({ host: "API.GitHub.com", owner: "Acme", repo: "Web" })).toEqual({
      host: "api.github.com",
      owner: "acme",
      repo: "web",
      prefix: "",
    });
  });

  it("treats the empty prefix as the default one", () => {
    const key = linkKeyOf({ host: "h", owner: "o", repo: "r" });
    expect(sameLinkKey(key, { ...key, prefix: "storyshelf" })).toBe(true);
    expect(sameLinkKey(key, { ...key, prefix: "e2e" })).toBe(false);
  });

  it("names a connection's host, with the public host by default", () => {
    expect(connectionHost("github-app", null)).toBe("api.github.com");
    expect(connectionHost("gitlab-token", null)).toBe("gitlab.com");
    expect(connectionHost("github-app", "https://GHES.example.com/api/v3")).toBe(
      "ghes.example.com",
    );
    expect(connectionHost("gitlab-token", "not a url")).toBe("gitlab.com");
  });

  it("matches only a project's git channels on the same host, repository and prefix", () => {
    const key = linkKeyOf({ host: "api.github.com", owner: "acme", repo: "web" });
    expect(channelHoldsKey(row({ owner: "ACME", repo: "web" }), key)).toBe(true);
    expect(channelHoldsKey(row({ owner: "acme", repo: "web" }, "slack"), key)).toBe(false);
    expect(channelHoldsKey(row({ owner: "acme", repo: "web" }, "github", null), key)).toBe(false);
    expect(channelHoldsKey({ ...row({}), config: "{" }, key)).toBe(false);
  });
});
