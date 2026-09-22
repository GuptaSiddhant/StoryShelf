import type { CaptureJob } from "@storyshelf/core/adapter/capture-queue";

/** Serialize a capture job into a queue message body (JSON, no newlines). */
export function serializeBody(job: CaptureJob): string {
  return JSON.stringify({
    buildId: job.buildId,
    reqId: job.reqId,
    queuedAt: new Date().toISOString(),
    status: "queued",
  });
}

/** Parse a queue message body, tolerant of malformed input. */
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

/** Combine Azure Storage Queues messageId + popReceipt into a single opaque receipt. */
export function encodeReceipt(messageId: string, popReceipt: string): string {
  return `${messageId}|${popReceipt}`;
}

/** Split an opaque receipt back into its Storage Queues components. */
export function decodeReceipt(receipt: string): { messageId: string; popReceipt: string } {
  const index = receipt.indexOf("|");
  if (index === -1) {
    return { messageId: receipt, popReceipt: "" };
  }
  return { messageId: receipt.slice(0, index), popReceipt: receipt.slice(index + 1) };
}

/** Body stored in an Azure Storage Queues message. */
export interface QueuedBody {
  buildId?: string;
  reqId?: string;
  queuedAt?: string;
  status?: string;
}
