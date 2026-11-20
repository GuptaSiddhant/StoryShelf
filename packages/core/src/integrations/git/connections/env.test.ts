import { describe, expect, it } from "vitest";
import { TEST_PRIVATE_KEY } from "../test-key.ts";
import { gitConfigFile, gitFromEnv } from "./env.ts";

const files: Record<string, string> = {
  "/run/secrets/gh.pem": TEST_PRIVATE_KEY,
  "/run/secrets/lab": "glpat-from-file\n",
};

function readFile(path: string): string {
  const text = files[path];
  if (text === undefined) {
    throw new Error(`no file ${path}`);
  }
  return text;
}

describe("gitFromEnv", () => {
  it("declares nothing on an empty environment", () => {
    expect(gitFromEnv({}, readFile)).toEqual({ connections: [], links: [] });
  });

  it("declares the GitHub App from the environment, its key inline or from a file", () => {
    const inline = gitFromEnv(
      { SHELF_GITHUB_APP_ID: "12", SHELF_GITHUB_APP_PRIVATE_KEY: TEST_PRIVATE_KEY },
      readFile,
    );
    expect(inline.connections).toHaveLength(1);
    expect(inline.connections?.[0]).toMatchObject({ id: "github", apiBase: null });
    const fromFile = gitFromEnv(
      {
        SHELF_GITHUB_APP_ID: "12",
        SHELF_GITHUB_APP_PRIVATE_KEY_FILE: "/run/secrets/gh.pem",
        SHELF_GITHUB_API_URL: "https://ghes.example.com/api/v3",
      },
      readFile,
    );
    expect(fromFile.connections?.[0]).toMatchObject({
      apiBase: "https://ghes.example.com/api/v3",
    });
  });

  it("declares the GitLab connection, defaulting to gitlab.com", () => {
    const options = gitFromEnv(
      { SHELF_GITLAB_TOKEN_FILE: "/run/secrets/lab", SHELF_GITLAB_TOKEN_EXPIRES: "2027-03-01" },
      readFile,
    );
    const lab = options.connections?.[0];
    expect(lab).toMatchObject({ id: "gitlab", apiBase: "https://gitlab.com" });
    expect(lab?.readSecret()).toBe("glpat-from-file");
  });

  it("refuses half a connection, naming the variables and never a value", () => {
    expect(() => gitFromEnv({ SHELF_GITHUB_APP_ID: "12" }, readFile)).toThrow(
      /SHELF_GITHUB_APP_PRIVATE_KEY/u,
    );
    expect(() => gitFromEnv({ SHELF_GITHUB_APP_PRIVATE_KEY: TEST_PRIVATE_KEY }, readFile)).toThrow(
      /SHELF_GITHUB_APP_ID/u,
    );
    expect(() => gitFromEnv({ SHELF_GITLAB_TOKEN: "glpat-x" }, readFile)).toThrow(
      /SHELF_GITLAB_TOKEN_EXPIRES/u,
    );
    expect(() =>
      gitFromEnv(
        {
          SHELF_GITLAB_TOKEN: "glpat-x",
          SHELF_GITLAB_TOKEN_FILE: "/run/secrets/lab",
          SHELF_GITLAB_TOKEN_EXPIRES: "2027-03-01",
        },
        readFile,
      ),
    ).toThrow(/not both/u);
  });

  it("adds the connections and links of SHELF_GIT_CONFIG_FILE", () => {
    files["/etc/shelf/git.json"] = JSON.stringify({
      connections: [
        {
          provider: "github-app",
          id: "org",
          appId: 99,
          privateKeyFile: "/run/secrets/gh.pem",
          posts: { pullRequests: false },
        },
        { provider: "gitlab-token", id: "lab2", token: "glpat-inline", expiresOn: "2027-05-05" },
      ],
      links: [{ connection: "org", project: "web", repository: "acme/web", prefix: "web" }],
    });
    const options = gitFromEnv(
      {
        SHELF_GITHUB_APP_ID: "12",
        SHELF_GITHUB_APP_PRIVATE_KEY: TEST_PRIVATE_KEY,
        SHELF_GIT_CONFIG_FILE: "/etc/shelf/git.json",
      },
      readFile,
    );
    expect(options.connections?.map((connection) => connection.id)).toEqual([
      "github",
      "org",
      "lab2",
    ]);
    expect(options.links).toEqual([
      { connection: "org", project: "web", repository: "acme/web", prefix: "web" },
    ]);
  });

  it("refuses a config file with a repeated id or a link to an unknown connection", () => {
    files["/etc/shelf/dup.json"] = JSON.stringify({
      connections: [
        { provider: "gitlab-token", id: "github", token: "t", expiresOn: "2027-01-01" },
      ],
    });
    expect(() =>
      gitFromEnv(
        {
          SHELF_GITHUB_APP_ID: "12",
          SHELF_GITHUB_APP_PRIVATE_KEY: TEST_PRIVATE_KEY,
          SHELF_GIT_CONFIG_FILE: "/etc/shelf/dup.json",
        },
        readFile,
      ),
    ).toThrow(/configured twice/u);
  });
});

describe("gitConfigFile", () => {
  it("names invalid fields, never their values", () => {
    expect(() => gitConfigFile("{", readFile)).toThrow(/not valid JSON/u);
    const bad = JSON.stringify({ connections: [{ provider: "github-app", id: "x", appId: {} }] });
    expect(() => gitConfigFile(bad, readFile)).toThrow(/connections\.0\.appId/u);
    const leaky = JSON.stringify({
      connections: [{ provider: "gitlab-token", id: "x", token: 5, expiresOn: "2027-01-01" }],
    });
    expect(() => gitConfigFile(leaky, readFile)).toThrow(/connections\.0\.token/u);
  });

  it("needs exactly one of a secret and its file", () => {
    const both = JSON.stringify({
      connections: [
        {
          provider: "gitlab-token",
          id: "x",
          token: "t",
          tokenFile: "/run/secrets/lab",
          expiresOn: "2027-01-01",
        },
      ],
    });
    expect(() => gitConfigFile(both, readFile)).toThrow(/exactly one/u);
    const neither = JSON.stringify({
      connections: [{ provider: "github-app", id: "x", appId: 1 }],
    });
    expect(() => gitConfigFile(neither, readFile)).toThrow(/exactly one/u);
  });
});
