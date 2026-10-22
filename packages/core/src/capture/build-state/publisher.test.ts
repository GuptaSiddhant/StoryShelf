import { describe, expect, it, vi } from "vitest";
import { createBuildStatePublisher } from "./publisher.ts";
import { statusLog, world } from "./test-world.ts";

describe("createBuildStatePublisher", () => {
  it("delivers inline without a queue and clears the channel's error", async () => {
    const w = await world();
    await w.channels.recordOutcome(w.channelId, "old error");
    await createBuildStatePublisher({ deps: w.deps }).request(w.build.id);
    expect(statusLog(w.git)).toEqual([
      ["storyshelf/testing", "pending"],
      ["storyshelf/storybook", "pending"],
    ]);
    expect((await w.channels.get(w.channelId))?.lastError).toBeNull();
  });

  it("records an inline failure on the channel and never rejects", async () => {
    const w = await world();
    w.failure.message = "HTTP 403: forbidden";
    await expect(createBuildStatePublisher({ deps: w.deps }).request(w.build.id)).resolves.toBe(
      undefined,
    );
    expect((await w.channels.get(w.channelId))?.lastError).toBe("HTTP 403: forbidden");
  });

  it("queues one job per git channel instead of delivering", async () => {
    const w = await world();
    const second = await w.channels.create({
      projectId: w.project.id,
      provider: "fake-git",
      config: { prefix: "alt" },
      secret: "t",
    });
    const enqueue = vi.fn(async (_job: { channelId: string; buildId: string }) => {});
    await createBuildStatePublisher({ deps: w.deps, enqueue }).request(w.build.id);
    expect(enqueue.mock.calls.map(([job]) => job)).toEqual([
      { channelId: w.channelId, buildId: w.build.id },
      { channelId: second.id, buildId: w.build.id },
    ]);
    expect(w.git.calls).toHaveLength(0);
  });

  it("falls back to inline delivery when queueing fails", async () => {
    const w = await world();
    const enqueue = vi.fn(async () => {
      throw new Error("database is down");
    });
    await createBuildStatePublisher({ deps: w.deps, enqueue }).request(w.build.id);
    expect(statusLog(w.git)).toHaveLength(2);
  });

  it("does nothing for a build that is gone or a project without git channels", async () => {
    const w = await world();
    const publisher = createBuildStatePublisher({ deps: w.deps });
    await publisher.request("gone");
    await w.channels.remove(w.channelId);
    await publisher.request(w.build.id);
    expect(w.git.calls).toHaveLength(0);
  });

  it("logs and swallows a failure to even look the build up", async () => {
    const w = await world();
    const warn = vi.fn();
    const broken = { ...w.deps, db: {} as never, logger: { warn } as never };
    await expect(createBuildStatePublisher({ deps: broken }).request("b")).resolves.toBe(undefined);
    expect(warn).toHaveBeenCalled();
  });
});
