/** Wire protocol between `ForkedCaptureQueue` (parent) and `IpcCaptureQueue` (capture child). Plain JSON only. */
import type { CaptureJob, PollableJob } from "../../adapters/capture-queue.ts";

/** Child to parent. */
export type ChildMessage =
  | { type: "poll"; id: number; waitMs: number }
  | { type: "ack"; receipt: string }
  | { type: "nack"; receipt: string; requeue: boolean; delayMs?: number; error?: string }
  | { type: "enqueue"; job: CaptureJob }
  /** The job under `receipt` made progress; renews its lease in the parent. */
  | { type: "progress"; receipt: string };

/** Parent to child: the answer to one `poll`. */
export type ParentMessage =
  | { type: "job"; id: number; job: PollableJob }
  | { type: "empty"; id: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isJob(value: unknown): value is CaptureJob {
  return isRecord(value) && typeof value["buildId"] === "string" && value["buildId"].length > 0;
}

/** Runtime guard for a message arriving from the child (never trust an IPC payload's shape). */
export function isChildMessage(value: unknown): value is ChildMessage {
  if (!isRecord(value)) {
    return false;
  }
  switch (value["type"]) {
    case "poll":
      return typeof value["id"] === "number" && typeof value["waitMs"] === "number";
    case "ack":
      return typeof value["receipt"] === "string";
    case "nack":
      return typeof value["receipt"] === "string" && typeof value["requeue"] === "boolean";
    case "enqueue":
      return isJob(value["job"]);
    case "progress":
      return typeof value["receipt"] === "string";
    default:
      return false;
  }
}

/** Runtime guard for a message arriving from the parent. */
export function isParentMessage(value: unknown): value is ParentMessage {
  if (!isRecord(value) || typeof value["id"] !== "number") {
    return false;
  }
  return value["type"] === "empty" || (value["type"] === "job" && isJob(value["job"]));
}
