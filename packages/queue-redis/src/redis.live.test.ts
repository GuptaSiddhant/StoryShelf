/**
 * Live Redis queue test — strictly real cloud, no faked ioredis.
 *
 * Gated on `LIVE_CLOUD=1` plus `REDIS_URL`, so hermetic `turbo test` never
 * touches Redis. The queue key is unique per run (`{key}`, `{key}:processing`,
 * `{key}:delayed` all derive from it), so parallel runs on a shared Redis
 * never interfere. Acked jobs leave no residue; `afterAll` drains stragglers
 * and quits the owned client.
 *
 * Required env when live:
 * - `REDIS_URL` — e.g. `redis://localhost:6379` or an
 *   ElastiCache/Memorystore/Upstash URL.
 */
import type { PollableCaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRedisCaptureQueue } from "./index.ts";

const LIVE = process.env["LIVE_CLOUD"] === "1" && process.env["REDIS_URL"] !== undefined;

function liveUrl(): string {
  const url = process.env["REDIS_URL"];
  if (!url) {
    throw new Error("Live Redis test requires REDIS_URL.");
  }
  return url;
}

function runKey(): string {
  const run = process.env["GITHUB_RUN_ID"] ?? "local";
  return `shelf:live:${run}:${randomUUID()}`;
}

function runBuildId(): string {
  const run = process.env["GITHUB_RUN_ID"] ?? "local";
  return `live-${run}-${randomUUID()}`;
}

async function drain(queue: PollableCaptureQueue): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- drain is sequential by design
    const job = await queue.poll({ waitMs: 0 });
    if (!job) {
      return;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- drain is sequential by design
    await queue.ack(job);
  }
}

describe.skipIf(!LIVE)("redis live (real Redis, gated on LIVE_CLOUD=1)", () => {
  let queue: PollableCaptureQueue;

  function activeQueue(): PollableCaptureQueue {
    if (!queue) {
      throw new Error("Live Redis harness not initialized");
    }
    return queue;
  }

  beforeAll(async () => {
    queue = createRedisCaptureQueue({ url: liveUrl(), key: runKey(), waitTimeSeconds: 2 });
    await expect(queue.lifecycle?.health()).resolves.toEqual({ ok: true });
  });

  afterAll(async () => {
    const target = activeQueue();
    await drain(target);
    await target.lifecycle?.teardown();
  });

  it("reports remote-queue contract: status null, active/recent empty", async () => {
    const target = activeQueue();
    expect(await target.status("no-such-build")).toBeNull();
    expect(await target.active()).toEqual([]);
    expect(await target.recent(5)).toEqual([]);
  });

  it("enqueues a job and polls it back, then acks", async () => {
    const target = activeQueue();
    const buildId = runBuildId();
    await target.enqueue({ buildId });

    const job = await target.poll({ waitMs: 5000 });
    expect(job?.buildId).toBe(buildId);
    if (job) {
      await target.ack(job);
    }

    expect(await target.poll({ waitMs: 0 })).toBeNull();
  }, 60000);

  it("nack with requeue:false drops the job", async () => {
    const target = activeQueue();
    const buildId = runBuildId();
    await target.enqueue({ buildId });

    const job = await target.poll({ waitMs: 5000 });
    expect(job?.buildId).toBe(buildId);
    if (job) {
      await target.nack(job, { requeue: false });
    }

    expect(await target.poll({ waitMs: 0 })).toBeNull();
  }, 60000);
});
