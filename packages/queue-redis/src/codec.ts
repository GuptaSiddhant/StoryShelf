/** Job serialization: requeue payloads, body parsing, and polled-job extraction. */
import type { PollableJob } from "@storyshelf/core/adapter/capture-queue";
import type { Logger } from "@storyshelf/core/logger";
import type { Redis } from "ioredis";
import type { QueuedBody } from "./types.ts";

/** Build the requeue payload, bumping the 0-indexed `attempts` counter. */
export function buildRequeuePayload(body: QueuedBody): string {
  const nextAttempts = (typeof body.attempts === "number" ? body.attempts : 0) + 1;
  return JSON.stringify({
    buildId: body.buildId,
    reqId: body.reqId,
    queuedAt: body.queuedAt ?? new Date().toISOString(),
    status: "queued",
    attempts: nextAttempts,
  });
}

/** Parse a raw Redis message, returning `{}` for malformed JSON. */
export function parseBody(raw: string): QueuedBody {
  try {
    return JSON.parse(raw) as QueuedBody;
  } catch {
    return {};
  }
}

/** Validate a moved message into a `PollableJob`, dropping malformed ones. */
export async function extractPolledJob(
  client: Redis,
  processingKey: string,
  raw: string | null,
  logger?: Logger,
): Promise<PollableJob | null> {
  if (raw === null || raw === "") {
    return null;
  }
  const body = parseBody(raw);
  if (!body.buildId) {
    await client.lrem(processingKey, 1, raw).catch(() => {});
    logger?.warn({ body: raw }, "received malformed Redis message without buildId");
    return null;
  }
  return {
    buildId: body.buildId,
    reqId: body.reqId,
    receipt: raw,
    attempts: typeof body.attempts === "number" ? body.attempts : 0,
    raw,
  };
}
