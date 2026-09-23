/** Enqueue and remote-queue no-op operations for Pub/Sub. */
import type { CaptureJob, QueueEntry } from "@storyshelf/core/adapter/capture-queue";
import { encodeData, serializeBody, topicPath } from "./codec.ts";
import type { GcpPubSubState } from "./types.ts";

/** Publish a serialized capture job with the buildId attribute. */
export async function enqueuePubSub(state: GcpPubSubState, job: CaptureJob): Promise<void> {
  await state.publisher.publish({
    topic: topicPath(state.projectId, state.topic),
    messages: [
      {
        data: encodeData(serializeBody(job)),
        attributes: { buildId: job.buildId },
      },
    ],
  });
}

/** Remote queues have no per-build status; the builds table is the source of truth. */
export async function pubSubStatus(_buildId: string): Promise<QueueEntry | null> {
  await Promise.resolve();
  return null;
}

/** Remote queues report no active entries; the builds table is the source of truth. */
export async function pubSubActive(): Promise<QueueEntry[]> {
  await Promise.resolve();
  return [];
}

/** Remote queues report no recent entries; the builds table is the source of truth. */
export async function pubSubRecent(_limit: number): Promise<QueueEntry[]> {
  await Promise.resolve();
  return [];
}
