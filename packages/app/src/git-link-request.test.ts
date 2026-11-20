import type { GitConnection } from "@storyshelf/core/models";
import { describe, expect, it } from "vitest";
import {
  connectionFor,
  parseRepositoryUrl,
  prefixProblem,
  proposedPrefix,
  webHostOf,
} from "./git-link-request.ts";

const connection = (id: string, provider: GitConnection["provider"], apiBase: string | null) =>
  ({ id, provider, apiBase, ignored: false }) as unknown as GitConnection;

describe("parseRepositoryUrl", () => {
  it("reads URLs, .git suffixes and owner/name", () => {
    expect(parseRepositoryUrl("https://GitHub.com/acme/widgets")).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "widgets",
    });
    expect(parseRepositoryUrl("https://gitlab.example.com/grp/sub/web.git/")).toEqual({
      host: "gitlab.example.com",
      owner: "grp/sub",
      repo: "web",
    });
    expect(parseRepositoryUrl("acme/widgets")).toEqual({
      host: null,
      owner: "acme",
      repo: "widgets",
    });
  });

  it("refuses anything else", () => {
    for (const text of ["", "widgets", "http://github.com/a/b", "https://github.com/a", "%%%"]) {
      expect(parseRepositoryUrl(text)).toBeNull();
    }
  });
});

describe("connectionFor", () => {
  const github = connection("gh", "github-app", null);
  const gitlab = connection("gl", "gitlab-token", "https://gitlab.example.com");

  it("maps the public API host to github.com and picks by host", () => {
    expect(webHostOf(github)).toBe("github.com");
    expect(webHostOf(gitlab)).toBe("gitlab.example.com");
    const repo = { owner: "a", repo: "b" };
    expect(connectionFor([github, gitlab], { host: "github.com", ...repo })?.id).toBe("gh");
    expect(connectionFor([github, gitlab], { host: "gitlab.example.com", ...repo })?.id).toBe("gl");
    expect(connectionFor([github, gitlab], { host: "other.example.com", ...repo })).toBeNull();
  });

  it("takes a host-less repository only when one connection could own it", () => {
    const repo = { host: null, owner: "a", repo: "b" };
    expect(connectionFor([github], repo)?.id).toBe("gh");
    expect(connectionFor([github, gitlab], repo)).toBeNull();
  });

  it("ignores a connection shadowed by configuration", () => {
    const shadowed = { ...github, ignored: true } as GitConnection;
    expect(connectionFor([shadowed], { host: "github.com", owner: "a", repo: "b" })).toBeNull();
  });
});

describe("prefixes", () => {
  it("proposes the default, then the slug, then slug-N", () => {
    expect(proposedPrefix("web", new Set())).toBe("storyshelf");
    expect(proposedPrefix("web", new Set(["storyshelf"]))).toBe("web");
    expect(proposedPrefix("web", new Set(["storyshelf", "web"]))).toBe("web-2");
  });

  it("accepts letters, digits, dots, dashes and underscores", () => {
    expect(prefixProblem("web_1.a-b")).toBeNull();
    expect(prefixProblem("no spaces")).not.toBeNull();
    expect(prefixProblem("x".repeat(41))).not.toBeNull();
  });
});
