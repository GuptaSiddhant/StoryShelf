/**
 * Live SQS queue test — strictly real cloud, no fakes.
 *
 * Gated on `LIVE_CLOUD=1` so hermetic `turbo test` never touches AWS.
 * The queue is pre-provisioned (manually or via `terraform apply` from
 * `storyshelf server init --target aws`); every message uses a unique
 * build id per run and is acked, so no cross-run interference.
 *
 * Required env when live:
 * - `QUEUE_URL` — existing SQS queue URL (from `terraform output -json` → `queue_url`)
 * - AWS credentials via the standard SDK chain (`AWS_ACCESS_KEY_ID` /
 *   `AWS_SECRET_ACCESS_KEY`, or an IAM role when running in AWS).
 */
import type { PollableCaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSqsCaptureQueue } from "./index.ts";

const LIVE = process.env["LIVE_CLOUD"] === "1";

function liveQueueUrl(): string {
  const url = process.env["QUEUE_URL"];
  if (!url) {
    throw new Error("Live SQS test requires QUEUE_URL (terraform output: queue_url).");
  }
  return url;
}

function runBuildId(): string {
  const run = process.env["GITHUB_RUN_ID"] ?? "local";
  return `live-${run}-${randomUUID()}`;
}

describe.skipIf(!LIVE)("sqs live (real AWS, gated on LIVE_CLOUD=1)", () => {
  let queue: PollableCaptureQueue;

  function activeQueue(): PollableCaptureQueue {
    if (!queue) {
      throw new Error("Live SQS harness not initialized");
    }
    return queue;
  }

  beforeAll(async () => {
    queue = createSqsCaptureQueue({ queueUrl: liveQueueUrl(), waitTimeSeconds: 5 });
    await expect(queue.lifecycle?.health()).resolves.toEqual({ ok: true });
  });

  afterAll(async () => {
    await activeQueue().lifecycle?.teardown?.();
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

    const job = await target.poll({ waitMs: 15_000 });
    expect(job?.buildId).toBe(buildId);
    if (job) {
      await target.ack(job);
    }

    expect(await target.poll({ waitMs: 2_000 })).toBeNull();
  }, 60_000);

  it("nack with requeue:false drops the job", async () => {
    const target = activeQueue();
    const buildId = runBuildId();
    await target.enqueue({ buildId });

    const job = await target.poll({ waitMs: 15_000 });
    expect(job?.buildId).toBe(buildId);
    if (job) {
      await target.nack(job, { requeue: false });
    }

    expect(await target.poll({ waitMs: 2_000 })).toBeNull();
  }, 60_000);
});
