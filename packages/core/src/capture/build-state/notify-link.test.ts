/** `notify` jobs and the publisher for repository links (ADR 0054): payload version 2, `{ linkId }`. */
import { describe, expect, it, vi } from "vitest";
import { CaptureJobModel } from "../../models/capture-job.ts";
import { rig } from "../consumer/test-fixtures.ts";
import type { ConsumerJob } from "../consumer/types.ts";
import { approvedGitHubLink, contextsOf, GITHUB_ID, linkWorld } from "./link-world.ts";
import {
  createNotifyEnqueuer,
  createNotifyHandler,
  NOTIFY_LINK_PAYLOAD_VERSION,
  notifyExhausted,
  type NotifyRequest,
} from "./notify-job.ts";
import { createBuildStatePublisher } from "./publisher.ts";
import { requestOpenBuildStates } from "./resume.ts";

async function queued() {
  const w = await linkWorld();
  const link = await approvedGitHubLink(w);
  const handler = createNotifyHandler({ deps: w.deps });
  const r = rig({ db: w.db, kinds: ["notify"], handlers: { notify: handler } });
  const enqueue = createNotifyEnqueuer(w.deps, r.queue);
  const jobs = async () =>
    (await new CaptureJobModel(w.db).listForBuild(w.build.id)).filter(
      (row) => row.kind === "notify",
    );
  return { w, link, handler, r, enqueue, jobs };
}

describe("a link's notify job", () => {
  it("is written at payload version 2 with the link id and its own single-flight key", async () => {
    const { w, link, enqueue, jobs } = await queued();
    await enqueue({ linkId: link.id, buildId: w.build.id });
    await enqueue({ linkId: link.id, buildId: w.build.id });
    const rows = await jobs();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.payload ?? "{}")).toEqual({
      v: NOTIFY_LINK_PAYLOAD_VERSION,
      data: { linkId: link.id },
    });
    expect(rows[0]?.activeKey).toBe(`notify:link:${link.id}:${w.build.id}`);
  });

  it("keeps a channel's job at version 1, which an older release reads", async () => {
    const { w, enqueue, jobs } = await queued();
    await enqueue({ channelId: w.channelId, buildId: w.build.id });
    expect(JSON.parse((await jobs())[0]?.payload ?? "{}")).toMatchObject({ v: 1 });
  });

  it("is handed back unrun by a release that reads only version 1 (ADR 0053)", async () => {
    const { w, link, jobs } = await queued();
    const run = vi.fn(async () => {});
    const old = rig({ db: w.db, kinds: ["notify"], handlers: { notify: { run } } });
    await createNotifyEnqueuer(w.deps, old.queue)({ linkId: link.id, buildId: w.build.id });
    const consumer = old.consume();
    const started = consumer.start();
    await old.clock.advance(100);
    await consumer.stop();
    await started;
    expect(run).not.toHaveBeenCalled();
    expect((await jobs())[0]?.status).not.toBe("failed");
  });

  it("is read by the handler, which delivers through the link", async () => {
    const { w, link, handler, r, enqueue, jobs } = await queued();
    expect(handler.payloadVersion).toBe(2);
    expect(handler.accepts?.({ buildId: "b", data: { linkId: "l" } })).toBe(true);
    expect(handler.accepts?.({ buildId: "b", data: { linkId: "" } })).toBe(false);
    await enqueue({ linkId: link.id, buildId: w.build.id });
    const consumer = r.consume();
    const started = consumer.start();
    await r.clock.advance(100);
    await consumer.stop();
    await started;
    expect((await jobs())[0]?.status).toBe("done");
    expect(contextsOf(w.github)).toEqual(["storyshelf/testing", "storyshelf/storybook"]);
  });

  it("raises onFailed for a link given up on, naming the link and its provider", async () => {
    const onFailed = vi.fn(async () => {});
    const { w, link } = await queued();
    await notifyExhausted({ deps: w.deps, onFailed })(
      { buildId: w.build.id, data: { linkId: link.id } } as ConsumerJob,
      "HTTP 500: boom",
    );
    expect(onFailed).toHaveBeenCalledWith({
      channelId: link.id,
      linkId: link.id,
      projectId: w.project.id,
      provider: "github",
      buildId: w.build.id,
      error: "HTTP 500: boom",
    });
    onFailed.mockClear();
    await notifyExhausted({ deps: w.deps, onFailed })(
      { buildId: w.build.id, data: { linkId: "gone" } } as ConsumerJob,
      "x",
    );
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("surfaces a last attempt's failure through the handler too", async () => {
    const onFailed = vi.fn(async () => {});
    const { w, link } = await queued();
    w.github.refuse.status = 500;
    const handler = createNotifyHandler({ deps: w.deps, onFailed });
    const job = {
      buildId: w.build.id,
      attempt: 5,
      maxAttempts: 5,
      data: { linkId: link.id },
    } as unknown as ConsumerJob;
    const context = {
      logger: w.deps.logger,
      touch: () => {},
      signal: new AbortController().signal,
    };
    await expect(handler.run(job, context)).rejects.toThrow("HTTP 500");
    expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ linkId: link.id }));
  });
});

async function withLinks() {
  const w = await linkWorld();
  const link = await approvedGitHubLink(w);
  await w.links.create({
    projectId: w.project.id,
    connectionId: GITHUB_ID,
    host: "api.github.com",
    owner: "acme",
    repo: "pending",
  });
  return { w, link };
}

describe("the publisher and links", () => {
  it("queues one job per channel and per approved link, never for a pending one", async () => {
    const { w, link } = await withLinks();
    const enqueue = vi.fn(async (_job: NotifyRequest) => {});
    await createBuildStatePublisher({ deps: w.deps, enqueue }).request(w.build.id);
    expect(enqueue.mock.calls.map(([job]) => job)).toEqual([
      { channelId: w.channelId, buildId: w.build.id },
      { linkId: link.id, buildId: w.build.id },
    ]);
  });

  it("queues only the named link, or only the named channel", async () => {
    const { w, link } = await withLinks();
    const enqueue = vi.fn(async (_job: NotifyRequest) => {});
    const publisher = createBuildStatePublisher({ deps: w.deps, enqueue });
    await publisher.request(w.build.id, { linkId: link.id });
    await publisher.request(w.build.id, { channelId: w.channelId });
    expect(enqueue.mock.calls.map(([job]) => job)).toEqual([
      { linkId: link.id, buildId: w.build.id },
      { channelId: w.channelId, buildId: w.build.id },
    ]);
  });

  it("queues no link without connections", async () => {
    const { w } = await withLinks();
    w.deps.gitConnections = undefined;
    const enqueue = vi.fn(async (_job: NotifyRequest) => {});
    await createBuildStatePublisher({ deps: w.deps, enqueue }).request(w.build.id);
    expect(enqueue.mock.calls.map(([job]) => job)).toEqual([
      { channelId: w.channelId, buildId: w.build.id },
    ]);
  });

  it("delivers inline without a queue (or when queueing fails), never throwing", async () => {
    const { w } = await withLinks();
    await createBuildStatePublisher({ deps: w.deps }).request(w.build.id);
    expect(contextsOf(w.github)).toEqual(["storyshelf/testing", "storyshelf/storybook"]);
    w.github.refuse.status = 500;
    const enqueue = vi.fn(async () => {
      await Promise.reject(new Error("queue down"));
    });
    await expect(
      createBuildStatePublisher({ deps: w.deps, enqueue }).request(w.build.id),
    ).resolves.toBeUndefined();
  });

  it("re-requests the open builds of a project for one link", async () => {
    const { w, link } = await withLinks();
    const request = vi.fn(async () => {});
    expect(
      await requestOpenBuildStates(
        w.deps,
        { request },
        { projectId: w.project.id, linkId: link.id },
      ),
    ).toBe(1);
    expect(request).toHaveBeenCalledWith(w.build.id, { linkId: link.id });
  });
});
