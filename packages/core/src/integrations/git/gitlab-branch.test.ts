import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicNetworkForTests } from "../../test-helpers/index.ts";
import { gitLabNotifier } from "./gitlab.ts";
import { stubFetch } from "./test-fetch.ts";

let restoreNetwork: (() => void) | undefined;
beforeEach(() => {
  restoreNetwork = publicNetworkForTests();
});
afterEach(() => {
  restoreNetwork?.();
  vi.unstubAllGlobals();
});

function check(config: Record<string, unknown> = {}): Promise<boolean> {
  const adapter = gitLabNotifier.create({
    config: { owner: "acme", repo: "web", ...config },
    secret: "glpat-test",
  });
  if (adapter.commitOnBranch === undefined) {
    throw new Error("the GitLab provider must answer commitOnBranch");
  }
  return adapter.commitOnBranch({ sha: "abc123", branch: "main" });
}

const branches = (...names: string[]): Response =>
  Response.json(names.map((name) => ({ type: "branch", name })));

describe("GitLab commitOnBranch", () => {
  it("reads the branches that contain the commit, with the channel's token", async () => {
    const calls = stubFetch(() => branches("feature/x", "main"));
    expect(await check()).toBe(true);
    expect(calls[0]?.url).toBe(
      "https://gitlab.com/api/v4/projects/acme%2Fweb/repository/commits/abc123/refs?type=branch&per_page=100&page=1",
    );
    expect(calls[0]?.init.headers).toMatchObject({ "PRIVATE-TOKEN": "glpat-test" });
  });

  it("says no when the default branch does not contain the commit", async () => {
    stubFetch(() => branches("feature/x"));
    expect(await check()).toBe(false);
  });

  it("does not take a tag of the same name for the branch", async () => {
    stubFetch(() => Response.json([{ type: "tag", name: "main" }]));
    expect(await check()).toBe(false);
  });

  it("reads further pages while they are full, and stops at the match", async () => {
    const full = Array.from({ length: 100 }, (_unused, index) => `b-${String(index)}`);
    const calls = stubFetch((url) =>
      url.endsWith("page=1") ? branches(...full) : branches("main"),
    );
    expect(await check()).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toContain("page=2");
  });

  it("uses a self-managed host through the outbound guard", async () => {
    const calls = stubFetch(() => branches("main"));
    expect(await check({ host: "https://git.example.com/" })).toBe(true);
    expect(calls[0]?.url.startsWith("https://git.example.com/api/v4/projects/")).toBe(true);
  });

  it("refuses a private self-managed host, so the claim fails closed", async () => {
    restoreNetwork?.();
    restoreNetwork = undefined;
    stubFetch(() => branches("main"));
    await expect(check({ host: "http://127.0.0.1" })).rejects.toThrow();
  });

  it("throws when GitLab refuses the request", async () => {
    stubFetch(() => Response.json({ message: "403 Forbidden" }, { status: 403 }));
    await expect(check()).rejects.toThrow();
  });
});
