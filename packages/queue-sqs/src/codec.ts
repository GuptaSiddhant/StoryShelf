/** MessageBody serialization for SQS capture jobs. */
import type { CaptureJob } from "@storyshelf/core/adapter/capture-queue";
import type { QueuedBody } from "./types.ts";

/** Serialize a capture job into the SQS MessageBody payload. */
export function serializeEnqueueBody(job: CaptureJob): string {
  return JSON.stringify({
    buildId: job.buildId,
    reqId: job.reqId,
    queuedAt: new Date().toISOString(),
    status: "queued",
  });
}

/** Parse an SQS MessageBody; returns empty on malformed JSON. */
export function parseBody(raw: string): QueuedBody {
  try {
    return JSON.parse(raw) as QueuedBody;
  } catch {
    return {};
  }
}
