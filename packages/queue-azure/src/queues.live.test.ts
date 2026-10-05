/**
 * Live Azure Storage Queues test — strictly real cloud, no fakes or Azurite.
 *
 * Gated on `LIVE_CLOUD=1` so hermetic `turbo test` never touches Azure.
 * The queue is pre-provisioned (manually or via `terraform apply` from
 * `storyshelf server init --target azure` with `queue_backend =
 * "storage-queues"`); every message uses a unique build id per run and is
 * acked, so no cross-run interference.
 *
 * Required env when live:
 * - `AZURE_STORAGE_CONNECTION` — storage account connection string
 *   (from `terraform output -json` → `storage_connection_string`)
 * - `LIVE_AZURE_QUEUE` — existing queue name (defaults to `capture-jobs`,
 *   matching the scaffold's baked `queue_name` output).
 */
import type { PollableCaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAzureStorageQueuesQueue } from "./storage-queues.ts";

const LIVE =
  process.env["LIVE_CLOUD"] === "1" && process.env["AZURE_STORAGE_CONNECTION"] !== undefined;

function liveConnectionString(): string {
  const value = process.env["AZURE_STORAGE_CONNECTION"];
  if (!value) {
    throw new Error(
      "Live Azure Queues test requires AZURE_STORAGE_CONNECTION (terraform output: storage_connection_string).",
    );
  }
  return value;
}

function liveQueueName(): string {
  return process.env["LIVE_AZURE_QUEUE"] ?? "capture-jobs";
}

function runBuildId(): string {
  const run = process.env["GITHUB_RUN_ID"] ?? "local";
  return `live-${run}-${randomUUID()}`;
}

describe.skipIf(!LIVE)("azure storage-queues live (real Azure, gated on LIVE_CLOUD=1)", () => {
  let queue: PollableCaptureQueue;

  function activeQueue(): PollableCaptureQueue {
    if (!queue) {
      throw new Error("Live Azure Queues harness not initialized");
    }
    return queue;
  }

  beforeAll(async () => {
    queue = createAzureStorageQueuesQueue({
      queueName: liveQueueName(),
      connectionString: liveConnectionString(),
      visibilityTimeout: 30,
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

    const job = await target.poll({ waitMs: 15000 });
    expect(job?.buildId).toBe(buildId);
    if (job) {
      await target.ack(job);
    }

    expect(await target.poll({ waitMs: 2000 })).toBeNull();
  }, 60000);

  it("nack with requeue:false drops the job", async () => {
    const target = activeQueue();
    const buildId = runBuildId();
    await target.enqueue({ buildId });

    const job = await target.poll({ waitMs: 15000 });
    expect(job?.buildId).toBe(buildId);
    if (job) {
      await target.nack(job, { requeue: false });
    }

    expect(await target.poll({ waitMs: 2000 })).toBeNull();
  }, 60000);
});
