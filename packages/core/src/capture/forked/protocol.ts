/**
 * Wire protocol between the app's forked capture handler (parent) and `runCaptureChild` (child).
 * Plain JSON only. The parent owns the queue: it pushes each leased job to the child, and the
 * child only reports on it (ADR 0006, decision 5), so there is no `poll`, `enqueue`, `ack` or `nack`.
 */
import type { ConsumerJob } from "../consumer/types.ts";

/** Parent to child. `runId` names one push of a job; a re-push after a crash gets a new one. */
export type ParentMessage =
  /** Run this leased job. The child holds the same database, storage and runner configuration. */
  | { type: "run"; runId: string; job: ConsumerJob }
  /** The lease is lost or the job was cancelled: stop the render (`runner.cancel`). */
  | { type: "cancel"; runId: string };

/** Child to parent. */
export type ChildMessage =
  /** The run made progress; the parent renews the job's lease. */
  | { type: "progress"; runId: string }
  /** The run finished; the parent acknowledges the job. */
  | { type: "done"; runId: string }
  /** The run threw; the parent retries or fails the job by its attempt count. */
  | { type: "failed"; runId: string; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isJob(value: unknown): value is ConsumerJob {
  return isRecord(value) && typeof value["buildId"] === "string" && value["buildId"].length > 0;
}

/** Runtime guard for a message arriving from the child (never trust an IPC payload's shape). */
export function isChildMessage(value: unknown): value is ChildMessage {
  if (!isRecord(value) || typeof value["runId"] !== "string") {
    return false;
  }
  const type = value["type"];
  return (
    type === "progress" ||
    type === "done" ||
    (type === "failed" && typeof value["error"] === "string")
  );
}

/** Runtime guard for a message arriving from the parent. */
export function isParentMessage(value: unknown): value is ParentMessage {
  if (!isRecord(value) || typeof value["runId"] !== "string") {
    return false;
  }
  return value["type"] === "cancel" || (value["type"] === "run" && isJob(value["job"]));
}
