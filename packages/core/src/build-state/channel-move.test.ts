import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_OUTPUTS } from "../adapters/notifier/outputs.ts";
import { stubFetch } from "../integrations/git/test-fetch.ts";
import { TEST_PRIVATE_KEY } from "../integrations/git/test-key.ts";
import { GitChannelChangedError, replaceChannelWithLink } from "../models/git-channel-move.ts";
import { perProjectGitChannelOf } from "../models/git-channel.ts";
import { GitRepositoryTakenError } from "../models/git-repository-taken-error.ts";
import { NotificationChannelModel } from "../models/notification-channel.ts";
import type { NotificationChannelRow } from "../schema/notification.ts";
import { moveGitChannel } from "./channel-move.ts";
import { GITHUB_ID, linkWorld, type LinkWorld } from "./link-world.ts";
import { SECRET } from "./test-world.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** GitHub answers that installation 777 covers repository 9001. */
function covered(): void {
  stubFetch((url) =>
    url.endsWith("/installation")
      ? Response.json({ id: 777 })
      : Response.json({ repositories: [{ id: 9001, full_name: "acme/web" }] }, { status: 201 }),
  );
}

async function setup(config: Record<string, unknown>, secret?: string) {
  const w = await linkWorld();
  const channels = new NotificationChannelModel(w.db, undefined, SECRET);
  const channel = await channels.create({
    projectId: w.project.id,
    provider: "github",
    config: { owner: "Acme", repo: "Web", ...config },
    secret,
  });
  const publisher = { request: vi.fn(async () => {}) };
  const deps = {
    db: w.db,
    gitConnections: w.connections,
    publisher,
    logger: w.deps.logger,
    channels,
  };
  const request = (target: { connectionId: string } | { fromChannel: true }) => ({
    channelId: channel.id,
    updatedAt: channel.updatedAt,
    target,
    movedBy: "admin",
  });
  return { w, channels, channel, publisher, deps, request };
}

async function storedChannels(w: LinkWorld): Promise<NotificationChannelRow[]> {
  return (await w.db.list(w.db.tables.notificationChannels)) as unknown as NotificationChannelRow[];
}

describe("moveGitChannel", () => {
  it("moves a token channel to an existing App: an approved, pinned link with the same prefix", async () => {
    const { w, channel, publisher, deps, request } = await setup({ prefix: "e2e" }, "ghp_token");
    covered();
    const result = await moveGitChannel(deps, request({ connectionId: GITHUB_ID }));
    expect(result).toMatchObject({
      moved: true,
      asked: 1,
      link: {
        projectId: w.project.id,
        connectionId: GITHUB_ID,
        host: "api.github.com",
        owner: "acme",
        repo: "web",
        prefix: "e2e",
        state: "approved",
        hostRepositoryId: "9001",
        installationId: "777",
        approvedBy: "admin",
      },
    });
    if (!result.moved) throw new Error("not moved");
    expect(JSON.parse(result.link.outputs)).toEqual(ALL_OUTPUTS);
    expect((await storedChannels(w)).some((row) => row.id === channel.id)).toBe(false);
    expect(publisher.request).toHaveBeenCalledWith(w.build.id, { linkId: result.link.id });
  });

  it("makes a GitHub App channel's own App a connection, in the same move", async () => {
    const { w, deps, request } = await setup(
      { mode: "checks", appId: "4242", installationId: "7" },
      TEST_PRIVATE_KEY,
    );
    covered();
    const result = await moveGitChannel(deps, request({ fromChannel: true }));
    expect(result).toMatchObject({ moved: true, connection: { name: "GitHub App 4242" } });
    if (!result.moved) throw new Error("not moved");
    const stored = await w.connections.get(result.link.connectionId);
    expect(stored).toMatchObject({ provider: "github-app", config: { appId: "4242" } });
    expect(JSON.stringify(stored)).not.toContain("PRIVATE KEY");
    expect(await w.connections.secretOf(result.link.connectionId)).toBe(TEST_PRIVATE_KEY.trim());
  });

  it("refuses to make a connection from a token channel: it needs an App connection first", async () => {
    const { w, deps, request } = await setup({}, "ghp_token");
    expect(await moveGitChannel(deps, request({ fromChannel: true }))).toEqual({
      moved: false,
      reason: "needs-app",
    });
    expect(await storedChannels(w)).toHaveLength(2);
  });

  it("refuses an App channel whose stored key is not a PEM key, naming no key", async () => {
    const { deps, request } = await setup(
      { mode: "checks", appId: "1", installationId: "7" },
      "nope",
    );
    expect(await moveGitChannel(deps, request({ fromChannel: true }))).toEqual({
      moved: false,
      reason: "bad-key",
    });
  });

  it("refuses a connection on another host or of another provider", async () => {
    const { w, deps, request } = await setup({}, "ghp_token");
    expect(await moveGitChannel(deps, request({ connectionId: w.gitlabId }))).toEqual({
      moved: false,
      reason: "unfit",
    });
    expect(await moveGitChannel(deps, request({ connectionId: "gone" }))).toEqual({
      moved: false,
      reason: "unfit",
    });
  });

  it("leaves the channel as it was when the connection does not cover the repository", async () => {
    const { w, channel, deps, request } = await setup({}, "ghp_token");
    stubFetch(() => new Response("{}", { status: 404 }));
    expect(await moveGitChannel(deps, request({ connectionId: GITHUB_ID }))).toEqual({
      moved: false,
      reason: "not-covered",
    });
    expect((await storedChannels(w)).some((row) => row.id === channel.id)).toBe(true);
    expect(await w.links.listAll()).toHaveLength(0);
  });

  it("throws on an inconclusive answer and changes nothing", async () => {
    const { w, deps, request } = await setup({}, "ghp_token");
    stubFetch(() => new Response("{}", { status: 502 }));
    await expect(moveGitChannel(deps, request({ connectionId: GITHUB_ID }))).rejects.toThrow();
    expect(await storedChannels(w)).toHaveLength(2);
    expect(await w.links.listAll()).toHaveLength(0);
  });

  it("refuses a channel edited or removed since the page showed it", async () => {
    const { channels, channel, deps, request } = await setup({}, "ghp_token");
    await expect(
      moveGitChannel(deps, { ...request({ connectionId: GITHUB_ID }), updatedAt: "earlier" }),
    ).rejects.toThrow(GitChannelChangedError);
    await channels.remove(channel.id);
    await expect(moveGitChannel(deps, request({ connectionId: GITHUB_ID }))).rejects.toThrow(
      GitChannelChangedError,
    );
  });
});

async function plan(config: Record<string, unknown> = {}) {
  const { w, channels, channel } = await setup(config, "ghp_token");
  const parsed = perProjectGitChannelOf(channel);
  if (parsed === null) throw new Error("no channel");
  const move = {
    channel: parsed,
    connection: { id: GITHUB_ID },
    pins: { hostRepositoryId: "9001", installationId: "777" },
    outputs: ALL_OUTPUTS,
    movedBy: "admin",
  };
  return { w, channels, channel, move };
}

describe("replaceChannelWithLink", () => {
  it("refuses a repository and prefix a link already holds, and keeps the channel", async () => {
    const { w, channel, move } = await plan();
    // A link created straight into the table (as a race would leave it).
    await w.db.insert(w.db.tables.gitRepositoryLinks, {
      ...(await w.links.create({ ...move.channel, connectionId: GITHUB_ID, prefix: "other" })),
      id: "race",
      prefix: "",
    });
    await expect(replaceChannelWithLink(w.db, move)).rejects.toThrow(GitRepositoryTakenError);
    expect((await storedChannels(w)).some((row) => row.id === channel.id)).toBe(true);
  });

  it("refuses when another project's channel posts to the same gate", async () => {
    const { w, channels, move } = await plan();
    await channels.create({
      projectId: "p2",
      provider: "github",
      config: { owner: "acme", repo: "web", prefix: "storyshelf" },
    });
    await expect(replaceChannelWithLink(w.db, move)).rejects.toMatchObject({ takenBy: "channel" });
  });

  it("rolls back the new connection and the link when a later step fails", async () => {
    const { w, channel, move } = await plan();
    const row = w.connections.prepare({
      provider: "github-app",
      name: "New",
      config: { appId: "1" },
      secret: TEST_PRIVATE_KEY,
    });
    const transact = vi.spyOn(w.db, "transact");
    transact.mockImplementationOnce(async (fn) => {
      const real = w.db.transact;
      transact.mockRestore();
      return await real!.call(w.db, async (tx) => {
        const result = await fn({
          ...tx,
          remove: async () => await Promise.reject(new Error("boom")),
        });
        return result;
      });
    });
    await expect(replaceChannelWithLink(w.db, { ...move, connection: { row } })).rejects.toThrow(
      "boom",
    );
    expect(await w.connections.get(row.id)).toBeNull();
    expect(await w.links.listAll()).toHaveLength(0);
    expect((await storedChannels(w)).some((stored) => stored.id === channel.id)).toBe(true);
  });
});
