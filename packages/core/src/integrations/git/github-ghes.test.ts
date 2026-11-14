/** GitHub Enterprise Server: every call goes to the channel's `apiUrl`, not github.com. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearInstallationTokens } from "./github-app.ts";
import { githubConfigSchema } from "./github-config.ts";
import { gitHubNotifier } from "./github.ts";
import { stubFetch } from "./test-fetch.ts";
import { TEST_PRIVATE_KEY } from "./test-key.ts";

const channel = {
  id: "c1",
  projectId: "p1",
  provider: "github",
  config: {},
  events: [],
  enabled: true,
};
const GHES = "https://ghes.example.com/api/v3";
const REPO = { owner: "acme", repo: "widgets", apiUrl: `${GHES}/` };

beforeEach(() => {
  clearInstallationTokens();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub Enterprise Server API base", () => {
  it("accepts an optional https API base in the config", () => {
    expect(githubConfigSchema.parse(REPO).apiUrl).toBe(`${GHES}/`);
    expect(() => githubConfigSchema.parse({ ...REPO, apiUrl: "not a url" })).toThrow();
  });

  it("posts commit statuses to the API base", async () => {
    const calls = stubFetch(() => Response.json({}));
    await gitHubNotifier.create({ config: REPO, secret: "t" }).setState({
      channel,
      target: { kind: "status", sha: "abc", context: "storyshelf/testing" },
      state: "success",
      url: "u",
    });
    expect(calls.map((call) => call.url)).toEqual([`${GHES}/repos/acme/widgets/statuses/abc`]);
  });

  it("looks up and writes the pull-request comment on the API base", async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith("/pulls")) {
        return Response.json([{ number: 7 }]);
      }
      return url.includes("/comments?") ? Response.json([]) : Response.json({ id: 1 });
    });
    await gitHubNotifier.create({ config: REPO, secret: "t" }).setState({
      channel,
      target: { kind: "comment", sha: "abc", markdown: "m" },
      state: "success",
      url: "https://shelf.example/b/1",
    });
    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) {
      expect(call.url.startsWith(`${GHES}/repos/acme/widgets/`)).toBe(true);
    }
  });

  it("exchanges the App token and posts check runs on the API base", async () => {
    const calls = stubFetch((url, init) => {
      if (url.endsWith("/access_tokens")) {
        return Response.json({ token: "ghs_inst", expires_at: "2099-01-01T00:00:00Z" });
      }
      return url.includes("/check-runs?")
        ? Response.json({ check_runs: [] })
        : Response.json({ id: init.method === "POST" ? 77 : 9 });
    });
    const config = { ...REPO, mode: "checks", appId: "1", installationId: "2" };
    await gitHubNotifier.create({ config, secret: TEST_PRIVATE_KEY }).setState({
      channel,
      target: { kind: "status", sha: "abc", context: "storyshelf/testing" },
      state: "pending",
      url: "u",
    });
    expect(calls[0]?.url).toBe(`${GHES}/app/installations/2/access_tokens`);
    for (const call of calls) {
      expect(call.url.startsWith(GHES)).toBe(true);
    }
  });

  it("checks that a commit is on a branch through the API base", async () => {
    const calls = stubFetch(() => Response.json({ status: "identical" }));
    const adapter = gitHubNotifier.create({ config: REPO, secret: "t" });
    await adapter.commitOnBranch?.({ sha: "abc", branch: "main" });
    expect(calls[0]?.url).toBe(`${GHES}/repos/acme/widgets/compare/main...abc?per_page=1`);
  });
});
