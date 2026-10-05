/**
 * Live GCP Pub/Sub queue test — strictly real cloud, no fakes or emulators.
 *
 * Gated on `LIVE_CLOUD=1` so hermetic `turbo test` never touches GCP.
 * Topic + subscription are pre-provisioned (manually or via `terraform
 * apply` from `storyshelf server init --target gcp`); every message uses a
 * unique build id per run and is acked, so no cross-run interference.
 *
 * Unlike SQS/Azure, Pub/Sub `poll()` is synchronous-pull with no wait: it
 * returns `null` immediately when empty. After `enqueue`, tests retry the
 * poll briefly to cover publish propagation.
 *
 * Required env when live:
 * - `GCP_PROJECT_ID` — GCP project id
 * - `LIVE_PUBSUB_TOPIC` — existing topic (from `terraform output -json` → `pubsub_topic`)
 * - `LIVE_PUBSUB_SUBSCRIPTION` — existing pull subscription (→ `pubsub_subscription`)
 * - Credentials via ADC (`GOOGLE_APPLICATION_CREDENTIALS`, or the
 *   `google-github-actions/auth` step in CI).
 */
import type { PollableCaptureQueue, PollableJob } from "@storyshelf/core/adapter/capture-queue";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGcpPubSubQueue } from "./index.ts";

const LIVE = process.env["LIVE_CLOUD"] === "1";
const POLL_ROUNDS = 10;
const POLL_INTERVAL_MS = 1000;

function liveProjectId(): string {
  const projectId = process.env["GCP_PROJECT_ID"];
  if (!projectId) {
    throw new Error("Live Pub/Sub test requires GCP_PROJECT_ID.");
  }
  return projectId;
}

function liveTopic(): string {
  const topic = process.env["LIVE_PUBSUB_TOPIC"];
  if (!topic) {
    throw new Error(
      "Live Pub/Sub test requires LIVE_PUBSUB_TOPIC (terraform output: pubsub_topic).",
    );
  }
  return topic;
}

function liveSubscription(): string {
  const subscription = process.env["LIVE_PUBSUB_SUBSCRIPTION"];
  if (!subscription) {
    throw new Error(
      "Live Pub/Sub test requires LIVE_PUBSUB_SUBSCRIPTION (terraform output: pubsub_subscription).",
    );
  }
  return subscription;
}

function runBuildId(): string {
  const run = process.env["GITHUB_RUN_ID"] ?? "local";
  return `live-${run}-${randomUUID()}`;
}

async function pollForBuild(
  queue: PollableCaptureQueue,
  buildId: string,
): Promise<PollableJob | null> {
  for (let round = 0; round < POLL_ROUNDS; round += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- propagation wait is sequential by design
    const job = await queue.poll();
    if (job?.buildId === buildId) {
      return job;
    }
    if (job) {
      // Not ours (parallel runs share nothing but timing): redeliver so the
      // owning run can still receive it.
      // oxlint-disable-next-line eslint/no-await-in-loop -- redelivery is sequential by design
      await queue.nack(job);
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- backoff is sequential by design
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

describe.skipIf(!LIVE)("gcp pubsub live (real GCP, gated on LIVE_CLOUD=1)", () => {
  let queue: PollableCaptureQueue;

  function activeQueue(): PollableCaptureQueue {
    if (!queue) {
      throw new Error("Live Pub/Sub harness not initialized");
    }
    return queue;
  }

  beforeAll(async () => {
    queue = createGcpPubSubQueue({
      topic: liveTopic(),
      subscription: liveSubscription(),
      projectId: liveProjectId(),
    });
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

    const job = await pollForBuild(target, buildId);
    expect(job?.buildId).toBe(buildId);
    if (job) {
      await target.ack(job);
    }

    expect(await target.poll()).toBeNull();
  }, 60000);

  it("nack with requeue:false drops the job", async () => {
    const target = activeQueue();
    const buildId = runBuildId();
    await target.enqueue({ buildId });

    const job = await pollForBuild(target, buildId);
    expect(job?.buildId).toBe(buildId);
    if (job) {
      await target.nack(job, { requeue: false });
    }

    expect(await pollForBuild(target, buildId)).toBeNull();
  }, 60000);
});
