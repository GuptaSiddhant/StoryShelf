import { afterEach, describe, expect, it, vi } from "vitest";
import { gitHubNotifier } from "./github.ts";
import { stubFetch } from "./test-fetch.ts";
import { TEST_PRIVATE_KEY } from "./test-key.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

function check(sha = "abc123", branch = "main"): Promise<boolean> {
  const adapter = gitHubNotifier.create({
    config: { owner: "acme", repo: "web" },
    secret: "ghp_test",
  });
  if (adapter.commitOnBranch === undefined) {
    throw new Error("the GitHub provider must answer commitOnBranch");
  }
  return adapter.commitOnBranch({ sha, branch });
}

describe("GitHub commitOnBranch", () => {
  it("compares the branch with the commit using the channel's token", async () => {
    const calls = stubFetch(() => Response.json({ status: "identical" }));
    expect(await check("abc123", "release/v1")).toBe(true);
    expect(calls[0]?.url).toBe(
      "https://api.github.com/repos/acme/web/compare/release%2Fv1...abc123?per_page=1",
    );
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer ghp_test" });
  });

  it.each([
    ["identical", true],
    ["behind", true],
    ["ahead", false],
    ["diverged", false],
    [undefined, false],
  ])("answers %s as %s", async (status, expected) => {
    stubFetch(() => Response.json(status === undefined ? {} : { status }));
    expect(await check()).toBe(expected);
  });

  it("throws when GitHub refuses the request, so the claim fails closed", async () => {
    stubFetch(() => Response.json({ message: "Not Found" }, { status: 404 }));
    const failure = await check().then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain("ghp_test");
  });

  it("asks with the App's installation token in checks mode", async () => {
    const calls = stubFetch((url) =>
      url.endsWith("/access_tokens")
        ? Response.json({ token: "ghs_install", expires_at: "2999-01-01T00:00:00Z" })
        : Response.json({ status: "behind" }),
    );
    const adapter = gitHubNotifier.create({
      config: { owner: "acme", repo: "web", mode: "checks", appId: "1", installationId: "2" },
      secret: TEST_PRIVATE_KEY,
    });
    expect(await adapter.commitOnBranch?.({ sha: "abc", branch: "main" })).toBe(true);
    const compare = calls.find((call) => call.url.includes("/compare/"));
    expect(compare?.init.headers).toMatchObject({ authorization: "Bearer ghs_install" });
  });
});
