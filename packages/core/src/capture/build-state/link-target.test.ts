import { afterEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "../../integrations/git/test-fetch.ts";
import { TEST_PRIVATE_KEY } from "../../integrations/git/test-key.ts";
import { HttpError } from "../../utils/index.ts";
import { defaultBranchStanding } from "../branch-standing.ts";
import { deliverBuildState, stateTargets } from "./deliver.ts";
import { approvedGitHubLink, contextsOf, GITHUB_ID, linkWorld } from "./link-world.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const status = (code: number) => () => new Response("{}", { status: code });

describe("delivery through an approved repository link", () => {
  it("posts with the connection's App, pinned to the approved repository id", async () => {
    const w = await linkWorld();
    const link = await approvedGitHubLink(w, { prefix: "e2e" });
    const result = await deliverBuildState(w.deps, { buildId: w.build.id, linkId: link.id });
    expect(result).toBe("delivered");
    expect(w.github.created[0]).toEqual({
      config: {
        owner: "acme",
        repo: "web",
        prefix: "e2e",
        mode: "checks",
        appId: "42",
        installationId: "777",
        repositoryId: "9001",
      },
      secret: TEST_PRIVATE_KEY.trim(),
    });
    expect(contextsOf(w.github)).toEqual(["e2e/testing", "e2e/storybook"]);
    expect(w.git.calls).toHaveLength(0);
  });

  it("follows the link's outputs: the gate stays, the rest can be off", async () => {
    const w = await linkWorld();
    const link = await approvedGitHubLink(w);
    await w.links.setOutputs(link.id, { storybook: false, comment: "off", annotations: false });
    await deliverBuildState(w.deps, { buildId: w.build.id, linkId: link.id });
    expect(contextsOf(w.github)).toEqual(["storyshelf/testing"]);
    expect(w.github.writes.some((write) => write.target.kind === "comment")).toBe(false);
  });

  it.each(["pending", "refused", "broken"] as const)(
    "posts nothing for a %s link",
    async (state) => {
      const w = await linkWorld();
      const link = await w.links.create({
        projectId: w.project.id,
        connectionId: GITHUB_ID,
        host: "api.github.com",
        owner: "acme",
        repo: "web",
      });
      if (state === "refused") await w.links.refuse(link.id);
      if (state === "broken") {
        await w.links.approve(link.id, { hostRepositoryId: "1", installationId: "2" }, "u");
        await w.links.markBroken(link.id, "gone");
      }
      expect(await deliverBuildState(w.deps, { buildId: w.build.id, linkId: link.id })).toBe(
        "link-not-approved",
      );
      expect(w.github.writes).toHaveLength(0);
    },
  );

  it("posts nothing without connections, for a removed connection, or another project's link", async () => {
    const w = await linkWorld();
    const link = await approvedGitHubLink(w);
    const ids = { buildId: w.build.id, linkId: link.id };
    const connections = w.deps.gitConnections;
    w.deps.gitConnections = undefined;
    expect(await deliverBuildState(w.deps, ids)).toBe("no-connection");
    w.deps.gitConnections = connections;
    await w.links.change(link.id, { connectionId: "removed" });
    await w.links.approve(link.id, { hostRepositoryId: "1", installationId: "2" }, "u");
    expect(await deliverBuildState(w.deps, ids)).toBe("no-connection");
    expect(await deliverBuildState(w.deps, { ...ids, linkId: "missing" })).toBe("no-channel");
    expect(w.github.writes).toHaveLength(0);
  });

  it("addresses a GitLab project by its numeric id with the connection's token", async () => {
    const w = await linkWorld();
    const created = await w.links.create({
      projectId: w.project.id,
      connectionId: w.gitlabId,
      host: "git.example.com",
      owner: "grp",
      repo: "web",
    });
    const link = await w.links.approve(created.id, { hostRepositoryId: "55" }, "u");
    expect(await deliverBuildState(w.deps, { buildId: w.build.id, linkId: link.id })).toBe(
      "delivered",
    );
    expect(w.gitlab.created[0]).toEqual({
      config: { owner: "grp", repo: "web", host: "https://git.example.com", projectId: "55" },
      secret: "glpat-secret",
    });
  });

  it("keeps the comment off under a connection that may not write pull requests", async () => {
    const w = await linkWorld();
    const link = await approvedGitHubLink(w);
    const connection = await w.connections.get(GITHUB_ID);
    vi.spyOn(w.connections, "get").mockResolvedValue({
      ...connection!,
      config: { ...connection!.config, posts: { pullRequests: false } },
    });
    await deliverBuildState(w.deps, { buildId: w.build.id, linkId: link.id });
    expect(w.github.writes.some((write) => write.target.kind === "comment")).toBe(false);
    expect(contextsOf(w.github)).toContain("storyshelf/testing");
  });
});

async function refused(code: number) {
  const w = await linkWorld();
  const link = await approvedGitHubLink(w);
  w.github.refuse.status = code;
  return { w, link, ids: { buildId: w.build.id, linkId: link.id } };
}

describe("a refused write through a link (decision 6)", () => {
  it("marks the link broken when the installation no longer covers the repository", async () => {
    const { w, link, ids } = await refused(404);
    const calls = stubFetch(status(422));
    expect(await deliverBuildState(w.deps, ids)).toBe("link-broken");
    expect(calls[0]?.url).toBe("https://api.github.com/app/installations/777/access_tokens");
    expect(await w.links.get(link.id)).toMatchObject({
      state: "broken",
      reason: "The GitHub App's installation no longer covers this repository",
    });
  });

  it("rethrows and keeps the link when it still holds (the refusal was about the commit)", async () => {
    const { w, link, ids } = await refused(404);
    stubFetch(() => Response.json({ token: "t" }, { status: 201 }));
    await expect(deliverBuildState(w.deps, ids)).rejects.toBeInstanceOf(HttpError);
    expect(await w.links.get(link.id)).toMatchObject({ state: "approved" });
  });

  it("pins the new installation when the App was reinstalled on the same repository", async () => {
    const { w, link, ids } = await refused(403);
    stubFetch((url) => {
      if (url.includes("/installations/777/")) return new Response("{}", { status: 404 });
      if (url.endsWith("/installation")) return Response.json({ id: 888 });
      return Response.json({ token: "t" }, { status: 201 });
    });
    await expect(deliverBuildState(w.deps, ids)).rejects.toBeInstanceOf(HttpError);
    expect(await w.links.get(link.id)).toMatchObject({ state: "approved", installationId: "888" });
  });

  it("rethrows on an inconclusive check (5xx, network) and keeps the link", async () => {
    const { w, link, ids } = await refused(401);
    stubFetch(status(503));
    await expect(deliverBuildState(w.deps, ids)).rejects.toBeInstanceOf(HttpError);
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(deliverBuildState(w.deps, ids)).rejects.toBeInstanceOf(HttpError);
    expect(await w.links.get(link.id)).toMatchObject({ state: "approved" });
  });

  it("never checks the link after a 5xx from the host", async () => {
    const { w, link, ids } = await refused(502);
    const calls = stubFetch(status(422));
    await expect(deliverBuildState(w.deps, ids)).rejects.toBeInstanceOf(HttpError);
    expect(calls).toHaveLength(0);
    expect(await w.links.get(link.id)).toMatchObject({ state: "approved" });
  });
});

async function unpinned() {
  const w = await linkWorld();
  const link = await w.links.create(
    {
      projectId: w.project.id,
      connectionId: GITHUB_ID,
      host: "api.github.com",
      owner: "acme",
      repo: "web",
    },
    { approvedBy: null },
  );
  return { w, link };
}

describe("a link approved by configuration (no pins yet)", () => {
  it("resolves and pins the repository id before its first delivery", async () => {
    const { w, link } = await unpinned();
    stubFetch((url) =>
      url.endsWith("/installation")
        ? Response.json({ id: 5 })
        : Response.json({ repositories: [{ id: 6, full_name: "acme/web" }] }, { status: 201 }),
    );
    expect(await deliverBuildState(w.deps, { buildId: w.build.id, linkId: link.id })).toBe(
      "delivered",
    );
    expect(await w.links.get(link.id)).toMatchObject({
      hostRepositoryId: "6",
      installationId: "5",
    });
    expect(w.github.created[0]?.config).toMatchObject({ repositoryId: "6", installationId: "5" });
  });

  it("breaks when the App does not cover the repository", async () => {
    const { w, link } = await unpinned();
    stubFetch(status(404));
    expect(await deliverBuildState(w.deps, { buildId: w.build.id, linkId: link.id })).toBe(
      "link-broken",
    );
    expect(await w.links.get(link.id)).toMatchObject({ state: "broken" });
  });
});

describe("links among a project's git targets", () => {
  it("lists channels and approved links, and leaves out a link that cannot be reached", async () => {
    const w = await linkWorld();
    const link = await approvedGitHubLink(w);
    await w.links.create({
      projectId: w.project.id,
      connectionId: GITHUB_ID,
      host: "api.github.com",
      owner: "acme",
      repo: "pending",
    });
    const configured = await w.links.create(
      {
        projectId: w.project.id,
        connectionId: GITHUB_ID,
        host: "api.github.com",
        owner: "acme",
        repo: "api",
      },
      { approvedBy: null },
    );
    stubFetch(status(503));
    const targets = await stateTargets(w.deps, w.project.id);
    expect(targets.map((target) => target.channel.id)).toEqual([w.channelId, link.id]);
    expect(targets[1]?.link?.id).toBe(link.id);
    expect(await w.links.get(configured.id)).toMatchObject({ state: "approved" });
  });

  it("confirms a default-branch claim through the link's connection", async () => {
    const w = await linkWorld();
    await w.channels.remove(w.channelId);
    await approvedGitHubLink(w);
    const claim = {
      build: { id: w.build.id, gitSha: "abc123", gitBranch: "main" },
      project: { id: w.project.id, gitDefaultBranch: "main", requireVerifiedDefault: true },
    };
    expect(await defaultBranchStanding(w.deps, claim)).toEqual({
      isDefault: true,
      verification: "verified",
    });
    w.github.onBranch = false;
    expect(await defaultBranchStanding(w.deps, claim)).toMatchObject({ verification: "refused" });
    expect(
      await defaultBranchStanding({ ...w.deps, gitConnections: undefined }, claim),
    ).toMatchObject({ verification: "unverified" });
  });
});
