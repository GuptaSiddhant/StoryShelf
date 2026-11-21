import { describe, expect, it } from "vitest";
import { gitlabTokenUrl, readConnectionPost } from "./git-connection-input.ts";

describe("readConnectionPost", () => {
  it("starts Connect GitHub with what the admin chose", () => {
    expect(
      readConnectionPost({ kind: "github-manifest", gh_org: "acme", gh_statuses: "on" }),
    ).toEqual({
      kind: "manifest",
      request: {
        name: "StoryShelf",
        organization: "acme",
        apiUrl: "",
        comment: false,
        statuses: true,
      },
    });
  });

  it("names the field of a bad organization, API URL or App name", () => {
    const post = readConnectionPost({
      kind: "github-manifest",
      gh_name: "x".repeat(35),
      gh_org: "not an org!",
      gh_api: "ftp://ghes",
    });
    expect(post).toMatchObject({ kind: "form", selected: "github-manifest" });
    expect(Object.keys(post.kind === "form" ? post.errors : {}).toSorted()).toEqual([
      "gh_api",
      "gh_name",
      "gh_org",
    ]);
  });

  it("asks for a numeric App ID before reading the key", () => {
    expect(readConnectionPost({ kind: "github-app", app_id: "abc", app_key: "k" })).toMatchObject({
      errors: { app_id: "The App ID is a number" },
    });
  });

  it("prepares GitLab's link only with a host and a group", () => {
    expect(
      readConnectionPost({
        kind: "gitlab-token",
        intent: "prepare",
        gl_host: "https://gitlab.com",
      }),
    ).toMatchObject({
      kind: "form",
      prepared: false,
      errors: { gl_group: "Enter the group the token is for" },
    });
    expect(
      readConnectionPost({
        kind: "gitlab-token",
        intent: "prepare",
        gl_host: "https://gitlab.com",
        gl_group: "acme",
      }),
    ).toMatchObject({ kind: "form", prepared: true, errors: {} });
  });

  it("stores a GitLab token with its expiry, group and comment ceiling", () => {
    const post = readConnectionPost({
      kind: "gitlab-token",
      gl_host: "https://gitlab.example.com/",
      gl_group: "acme/web",
      gl_token: "glpat-x",
      gl_expires: "2099-01-01",
      gl_comment: "on",
    });
    expect(post).toEqual({
      kind: "store",
      input: {
        provider: "gitlab-token",
        name: "GitLab",
        apiBase: "https://gitlab.example.com",
        config: { expiresOn: "2099-01-01", group: "acme/web", posts: { pullRequests: true } },
        secret: "glpat-x",
      },
    });
  });

  it("refuses a post without a known option", () => {
    expect(readConnectionPost({ kind: "svn" })).toMatchObject({
      kind: "form",
      errors: { form: "Choose a kind" },
    });
  });
});

describe("gitlabTokenUrl", () => {
  it("prefills the group's token form with a name and the api scope", () => {
    expect(gitlabTokenUrl("https://gitlab.example.com/sub", "acme/web")).toBe(
      "https://gitlab.example.com/groups/acme/web/-/settings/access_tokens?name=StoryShelf&scopes=api",
    );
  });
});
