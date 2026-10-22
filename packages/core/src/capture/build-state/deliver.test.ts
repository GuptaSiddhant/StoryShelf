import { describe, expect, it } from "vitest";
import { storybookDir } from "../../utils/paths.ts";
import { deliverBuildState, stateTargets } from "./deliver.ts";
import { statusLog, world } from "./test-world.ts";

describe("deliverBuildState", () => {
  it("shows a build that was never captured: pending statuses and the comment", async () => {
    const w = await world();
    const result = await deliverBuildState(w.deps, { buildId: w.build.id, channelId: w.channelId });
    expect(result).toBe("delivered");
    expect(statusLog(w.git)).toEqual([
      ["storyshelf/testing", "pending"],
      ["storyshelf/storybook", "pending"],
    ]);
    expect(w.git.calls.at(-1)?.target.kind).toBe("comment");
    expect(w.git.calls[0]?.url).toBe(
      `https://shelf.example.com/projects/${w.project.slug}/builds/${w.build.id}`,
    );
    expect(w.git.secrets).toEqual(["ghp_token"]);
  });

  it("links with the resolved public origin, which wins over the configured base URL", async () => {
    const w = await world();
    const deps = {
      ...w.deps,
      publicOrigin: async () => await Promise.resolve("https://detected.example.com"),
    };
    await deliverBuildState(deps, { buildId: w.build.id, channelId: w.channelId });
    expect(w.git.calls[0]?.url).toBe(
      `https://detected.example.com/projects/${w.project.slug}/builds/${w.build.id}`,
    );
  });

  it("omits every link and the comment while no public origin is known", async () => {
    const w = await world();
    const deps = {
      ...w.deps,
      config: {},
      // An empty origin counts as none.
      publicOrigin: async () => await Promise.resolve(""),
    };
    await deliverBuildState(deps, { buildId: w.build.id, channelId: w.channelId });
    expect(statusLog(w.git)).toEqual([
      ["storyshelf/testing", "pending"],
      ["storyshelf/storybook", "pending"],
    ]);
    expect(w.git.calls.map((call) => call.url)).toEqual([undefined, undefined]);
    expect(w.git.calls.some((call) => call.target.kind === "comment")).toBe(false);
  });

  it("reads the build as it is now", async () => {
    const w = await world();
    await w.builds.setStatus(w.build.id, "approved");
    await deliverBuildState(w.deps, { buildId: w.build.id, channelId: w.channelId });
    expect(statusLog(w.git)[0]).toEqual(["storyshelf/testing", "success"]);
  });

  it("marks the Storybook published once its manifest exists", async () => {
    const w = await world();
    await w.storage.write(
      `${storybookDir(w.project.id, w.build.id)}/manifest.json`,
      Buffer.from("{}"),
    );
    await deliverBuildState(w.deps, { buildId: w.build.id, channelId: w.channelId });
    expect(statusLog(w.git)).toContainEqual(["storyshelf/storybook", "success"]);
  });

  it("names statuses after the channel prefix", async () => {
    const w = await world({ config: { prefix: "storyshelf-web" } });
    await deliverBuildState(w.deps, { buildId: w.build.id, channelId: w.channelId });
    expect(statusLog(w.git).map(([context]) => context)).toEqual([
      "storyshelf-web/testing",
      "storyshelf-web/storybook",
    ]);
  });

  it("posts only the Storybook status without testing", async () => {
    const w = await world();
    await deliverBuildState(
      { ...w.deps, flags: () => ({ testing: false, review: false }) },
      { buildId: w.build.id, channelId: w.channelId },
    );
    expect(statusLog(w.git)).toEqual([["storyshelf/storybook", "pending"]]);
  });

  it("writes nothing for a local identity", async () => {
    const w = await world();
    await w.db.update(w.db.tables.builds, w.build.id, { gitSha: "local-a1b2c3d4e5f6" });
    expect(await deliverBuildState(w.deps, { buildId: w.build.id, channelId: w.channelId })).toBe(
      "delivered",
    );
    expect(w.git.calls).toHaveLength(0);
  });

  it("throws when the host refuses, and says why nothing was written otherwise", async () => {
    const w = await world();
    w.failure.message = "HTTP 401: Bad credentials";
    await expect(
      deliverBuildState(w.deps, { buildId: w.build.id, channelId: w.channelId }),
    ).rejects.toThrow("HTTP 401");
    expect(await deliverBuildState(w.deps, { buildId: "gone", channelId: w.channelId })).toBe(
      "no-build",
    );
    expect(await deliverBuildState(w.deps, { buildId: w.build.id, channelId: "gone" })).toBe(
      "no-channel",
    );
    await w.db.update(w.db.tables.notificationChannels, w.channelId, { enabled: false });
    expect(await deliverBuildState(w.deps, { buildId: w.build.id, channelId: w.channelId })).toBe(
      "disabled",
    );
    await w.db.update(w.db.tables.notificationChannels, w.channelId, {
      enabled: true,
      provider: "unwired",
    });
    expect(await deliverBuildState(w.deps, { buildId: w.build.id, channelId: w.channelId })).toBe(
      "no-provider",
    );
  });

  it("refuses a channel of another project", async () => {
    const w = await world();
    const other = await world({ db: w.db });
    expect(
      await deliverBuildState(w.deps, { buildId: w.build.id, channelId: other.channelId }),
    ).toBe("no-channel");
  });
});

describe("stateTargets", () => {
  it("lists enabled channels of wired state providers, skipping unreadable secrets", async () => {
    const w = await world();
    await w.channels.create({ projectId: w.project.id, provider: "slack-webhook", config: {} });
    await w.channels.create({
      projectId: w.project.id,
      provider: "fake-git",
      config: {},
      secret: "t",
      enabled: false,
    });
    expect((await stateTargets(w.deps, w.project.id)).map((t) => t.channel.id)).toEqual([
      w.channelId,
    ]);
    const unreadable = await stateTargets(
      { ...w.deps, secret: "another-secret-0123456789ab" },
      w.project.id,
    );
    expect(unreadable).toEqual([]);
  });
});
