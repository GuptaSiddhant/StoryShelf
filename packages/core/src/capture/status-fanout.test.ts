import { describe, expect, it } from "vitest";
import { NotificationChannelModel } from "../models/notification-channel.ts";
import type { Project } from "../schema/project.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { makeFakeStateNotifier } from "../test-helpers/fake-notifier.ts";
import { postStatusesForBuild } from "./status-fanout.ts";

const SECRET = "test-secret-0123456789abcdef";
const project = { id: "p1", slug: "demo" } as Project;

async function setup(config: Record<string, unknown> = {}) {
  const { db } = makeDatabase();
  const tables = { notificationChannels: db.tables.notificationChannels };
  const channels = new NotificationChannelModel(db, tables, SECRET);
  const channel = await channels.create({
    projectId: project.id,
    provider: "fake-git",
    config,
    secret: "ghp_token",
  });
  const fake = makeFakeStateNotifier();
  return { db, tables, channels, channel, fake };
}

function post(
  world: Awaited<ReturnType<typeof setup>>,
  sha: string,
  notifiers = [world.fake.provider],
) {
  return postStatusesForBuild({
    db: world.db,
    tables: world.tables,
    project,
    sha,
    status: "success",
    url: "https://shelf.example.com/builds/b1",
    notifiers,
    secret: SECRET,
  });
}

describe("postStatusesForBuild", () => {
  it("writes the status and the comment to a git channel with its decrypted token", async () => {
    const world = await setup();
    await post(world, "abc123def456");
    expect(world.fake.calls.map((call) => call.target.kind)).toEqual(["status", "comment"]);
    expect(world.fake.calls[0]).toMatchObject({
      state: "success",
      url: "https://shelf.example.com/builds/b1",
      target: { kind: "status", sha: "abc123def456", context: "storyshelf/testing" },
    });
    expect(world.fake.secrets).toEqual(["ghp_token"]);
  });

  it("names the status after the channel prefix, so two projects in one repo stay apart", async () => {
    const world = await setup({ prefix: "storyshelf-web" });
    await post(world, "abc123def456");
    expect(world.fake.calls[0]?.target).toMatchObject({ context: "storyshelf-web/testing" });
  });

  it("skips synthetic local shas", async () => {
    const world = await setup();
    await post(world, "local-a1b2c3d4e5f6");
    expect(world.fake.calls).toHaveLength(0);
  });

  it("skips disabled channels and channels of other projects", async () => {
    const world = await setup();
    await world.db.update(world.tables.notificationChannels, world.channel.id, { enabled: false });
    await world.channels.create({
      projectId: "other",
      provider: "fake-git",
      config: {},
      secret: "t",
    });
    await post(world, "abc123def456");
    expect(world.fake.calls).toHaveLength(0);
  });

  it("does nothing without notifiers", async () => {
    const world = await setup();
    await post(world, "abc123def456", []);
    expect(world.fake.calls).toHaveLength(0);
  });

  it("records the delivery error on the channel and clears it on the next success", async () => {
    const world = await setup();
    const failing = makeFakeStateNotifier("fake-git", "HTTP 401: Bad credentials");
    await post(world, "abc123def456", [failing.provider]);
    expect((await world.channels.get(world.channel.id))?.lastError).toBe(
      "HTTP 401: Bad credentials",
    );

    await post(world, "abc123def456");
    expect((await world.channels.get(world.channel.id))?.lastError).toBeNull();
  });

  it("skips a channel whose token no key can decrypt, without failing the others", async () => {
    const world = await setup();
    await new NotificationChannelModel(
      world.db,
      world.tables,
      "another-secret-0123456789ab",
    ).create({
      projectId: project.id,
      provider: "fake-git",
      config: {},
      secret: "unreadable",
    });
    await post(world, "abc123def456");
    expect(world.fake.secrets).toEqual(["ghp_token"]);
  });
});
