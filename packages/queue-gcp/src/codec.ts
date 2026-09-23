/** Job serialization and Pub/Sub resource-path helpers. */
import type { CaptureJob } from "@storyshelf/core/adapter/capture-queue";
import type { QueuedBody } from "./types.ts";

/** Serialize a capture job into a Pub/Sub message body (JSON, no newlines). */
export function serializeBody(job: CaptureJob): string {
  return JSON.stringify({
    buildId: job.buildId,
    reqId: job.reqId,
    queuedAt: new Date().toISOString(),
    status: "queued",
  });
}

/** Parse a Pub/Sub message body, tolerant of malformed input. */
export function parseBody(raw: string): QueuedBody {
  try {
    const parsed = JSON.parse(raw) as QueuedBody;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

/** Decode raw Pub/Sub message bytes (or emulator string payloads) to text. */
export function decodeData(data: Uint8Array | string): string {
  return typeof data === "string" ? data : new TextDecoder().decode(data);
}

/** Encode a message body to bytes for publish. */
export function encodeData(body: string): Uint8Array {
  return new TextEncoder().encode(body);
}

/** Fully-qualified topic path for Pub/Sub API calls. */
export function topicPath(projectId: string, topic: string): string {
  return `projects/${projectId}/topics/${topic}`;
}

/** Fully-qualified subscription path for Pub/Sub API calls. */
export function subscriptionPath(projectId: string, subscription: string): string {
  return `projects/${projectId}/subscriptions/${subscription}`;
}
