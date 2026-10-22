/** The GitHub provider in `checks` mode: a recorded GitHub answers the App and Checks APIs. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearInstallationTokens } from "./github-app.ts";
import { gitHubNotifier } from "./github.ts";
import { bodyOf, stubFetch } from "./test-fetch.ts";
import { TEST_PRIVATE_KEY } from "./test-key.ts";

const channel = {
  id: "c1",
  projectId: "p1",
  provider: "github",
  config: {},
  events: [],
  enabled: true,
};
const adapter = () => gitHubNotifier.create({ config: CONFIG, secret: TEST_PRIVATE_KEY });
async function writeGate(state: "pending" | "success"): Promise<void> {
  await adapter().setState({
    channel,
    target: { kind: "status", sha: "abc", context: "storyshelf/testing" },
    state,
    url: "u",
  });
}

const CONFIG = { owner: "acme", repo: "widgets", mode: "checks", appId: "1", installationId: "2" };

/** Answers the token exchange, an empty check-run list, creates, and comment lookups. */
function recordedGitHub() {
  return stubFetch((url, init) => {
    if (url.endsWith("/access_tokens")) {
      return Response.json({ token: "ghs_inst", expires_at: "2099-01-01T00:00:00Z" });
    }
    if (url.includes("/check-runs?")) {
      return Response.json({ check_runs: [] });
    }
    if (url.endsWith("/pulls")) {
      return Response.json([]);
    }
    return Response.json({ id: init.method === "POST" ? 77 : 9 });
  });
}

beforeEach(() => {
  clearInstallationTokens();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gitHubNotifier in checks mode", () => {
  it("posts a check run with the App's installation token, not the PEM", async () => {
    const calls = recordedGitHub();
    await adapter().setState({
      channel,
      target: { kind: "status", sha: "abc", context: "storyshelf/testing", progress: "queued" },
      state: "pending",
      url: "https://shelf.example/b/1",
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.github.com/app/installations/2/access_tokens",
      "https://api.github.com/repos/acme/widgets/commits/abc/check-runs?filter=latest&per_page=100&check_name=storyshelf%2Ftesting",
      "https://api.github.com/repos/acme/widgets/check-runs",
    ]);
    expect(calls[2]?.init.headers).toMatchObject({ authorization: "Bearer ghs_inst" });
    expect(bodyOf(calls[2])).toMatchObject({ status: "queued", head_sha: "abc" });
    expect(JSON.stringify(calls.map((call) => call.init.body))).not.toContain("PRIVATE KEY");
  });

  it("exchanges for the installation token once and reuses it", async () => {
    const calls = recordedGitHub();
    await writeGate("pending");
    await writeGate("success");
    expect(calls.filter((call) => call.url.endsWith("/access_tokens"))).toHaveLength(1);
  });

  it("shows a failed Storybook publish as neutral, never as a failed gate", async () => {
    const calls = recordedGitHub();
    await adapter().setState({
      channel,
      target: { kind: "status", sha: "abc", context: "storyshelf/storybook", informational: true },
      state: "failure",
      url: "u",
    });
    expect(bodyOf(calls.at(-1))).toMatchObject({ status: "completed", conclusion: "neutral" });
  });

  it("keeps the pull-request comment, with the installation token", async () => {
    const calls = recordedGitHub();
    await adapter().setState({
      channel,
      target: { kind: "comment", sha: "abc", markdown: "m" },
      state: "success",
      url: "https://shelf.example/b/1",
    });
    expect(calls.at(-1)?.url).toBe("https://api.github.com/repos/acme/widgets/commits/abc/pulls");
    expect(calls.at(-1)?.init.headers).toMatchObject({ authorization: "Bearer ghs_inst" });
  });

  it("needs the App ids and a private key", () => {
    expect(() =>
      gitHubNotifier.create({ config: { ...CONFIG, appId: undefined }, secret: "k" }),
    ).toThrow("appId");
    expect(() =>
      gitHubNotifier.create({ config: { ...CONFIG, installationId: "abc" }, secret: "k" }),
    ).toThrow("installation ID");
    expect(() => gitHubNotifier.create({ config: CONFIG })).toThrow(
      "GitHub channel needs a private key",
    );
  });

  it("stays on commit statuses by default and ignores App fields", async () => {
    const calls = stubFetch(() => Response.json({}));
    await gitHubNotifier
      .create({ config: { owner: "a", repo: "b", mode: "statuses" }, secret: "ghp_t" })
      .setState({
        channel,
        target: { kind: "status", sha: "abc", context: "storyshelf/testing" },
        state: "success",
      });
    expect(calls[0]?.url).toBe("https://api.github.com/repos/a/b/statuses/abc");
  });
});
