import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { TEST_PRIVATE_KEY } from "../test-key.ts";
import { assertGitOptions, githubApp, gitlabGroup } from "./define.ts";

const KEY_BODY = TEST_PRIVATE_KEY.split("\n")[1] ?? "";

describe("githubApp", () => {
  it("declares a GitHub App connection with its permission ceiling", () => {
    const app = githubApp({ id: "acme", appId: 42, privateKey: TEST_PRIVATE_KEY });
    expect(app).toMatchObject({
      id: "acme",
      provider: "github-app",
      name: "GitHub App",
      apiBase: null,
      config: { appId: "42", posts: { pullRequests: true, statuses: false } },
    });
    expect(app.readSecret()).toBe(TEST_PRIVATE_KEY.trim());
  });

  it("accepts a one-line key and a GitHub Enterprise Server API base", () => {
    const oneLine = TEST_PRIVATE_KEY.replaceAll("\n", String.raw`\n`);
    const app = githubApp({
      id: "ghes",
      appId: "7",
      privateKey: oneLine,
      apiUrl: "https://ghes.example.com/api/v3/",
      posts: { pullRequests: false, statuses: true },
    });
    expect(app.apiBase).toBe("https://ghes.example.com/api/v3");
    expect(app.readSecret()).toContain("\n");
    expect(app.config["posts"]).toEqual({ pullRequests: false, statuses: true });
  });

  it("never serializes or prints the private key", () => {
    const app = githubApp({ id: "acme", appId: 42, privateKey: TEST_PRIVATE_KEY });
    expect(JSON.stringify(app)).not.toContain(KEY_BODY);
    expect(inspect(app, { depth: 5 })).not.toContain(KEY_BODY);
    expect(Object.isFrozen(app)).toBe(true);
  });

  it("refuses a bad id, app id, key or URL without echoing the key", () => {
    expect(() => githubApp({ id: "a b", appId: 1, privateKey: TEST_PRIVATE_KEY })).toThrow(/id/u);
    expect(() => githubApp({ id: "a", appId: "x1", privateKey: TEST_PRIVATE_KEY })).toThrow(
      /appId/u,
    );
    expect(() =>
      githubApp({ id: "a", appId: 1, privateKey: TEST_PRIVATE_KEY, apiUrl: "ftp://x" }),
    ).toThrow(/http/u);
    expect(() => githubApp({ id: "a", appId: 1, privateKey: "nope", apiUrl: "::" })).toThrow();
    try {
      githubApp({ id: "a", appId: 1, privateKey: `${TEST_PRIVATE_KEY.slice(0, 200)}garbage` });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toMatch(/not a PEM private key/u);
      expect(String(error)).not.toContain(KEY_BODY);
    }
  });
});

describe("gitlabGroup", () => {
  it("declares a GitLab token connection on its host's origin", () => {
    const lab = gitlabGroup({
      id: "lab",
      host: "https://gitlab.example.com/",
      token: " glpat-secret ",
      expiresOn: "2027-01-31",
    });
    expect(lab).toMatchObject({
      provider: "gitlab-token",
      apiBase: "https://gitlab.example.com",
      config: { expiresOn: "2027-01-31" },
    });
    expect(lab.readSecret()).toBe("glpat-secret");
    expect(JSON.stringify(lab)).not.toContain("glpat-secret");
  });

  it("refuses an empty token, a bad expiry or a bad host", () => {
    const base = { id: "lab", host: "https://gitlab.com", token: "t", expiresOn: "2027-01-31" };
    expect(() => gitlabGroup({ ...base, token: " " })).toThrow(/token is empty/u);
    expect(() => gitlabGroup({ ...base, expiresOn: "soon" })).toThrow(/expiresOn/u);
    expect(() => gitlabGroup({ ...base, expiresOn: "2027-13-45" })).toThrow(/expiresOn/u);
    expect(() => gitlabGroup({ ...base, host: "gitlab" })).toThrow(/not a URL/u);
  });
});

describe("assertGitOptions", () => {
  const app = githubApp({ id: "gh", appId: 1, privateKey: TEST_PRIVATE_KEY });
  const link = { connection: "gh", project: "web", repository: "acme/web" };

  it("accepts unique connections and links to them or to stored ones", () => {
    expect(() => assertGitOptions({})).not.toThrow();
    expect(() => assertGitOptions({ connections: [app], links: [link] })).not.toThrow();
    const stored = { ...link, connection: "01STORED" };
    expect(() => assertGitOptions({ links: [stored] })).not.toThrow();
    expect(() => assertGitOptions({ links: [stored] }, new Set(["01STORED"]))).not.toThrow();
  });

  it("refuses a repeated id, an unknown connection or a bad repository", () => {
    expect(() => assertGitOptions({ connections: [app, app] })).toThrow(/configured twice/u);
    expect(() => assertGitOptions({ links: [link] }, new Set())).toThrow(/unknown connection/u);
    expect(() =>
      assertGitOptions({ connections: [app], links: [{ ...link, repository: "web" }] }),
    ).toThrow(/owner\/repo/u);
    expect(() =>
      assertGitOptions({
        connections: [app],
        links: [{ ...link, repository: "group/sub/project" }],
      }),
    ).not.toThrow();
  });
});
