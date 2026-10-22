/** Codec of the database queue: job payload JSON and the row → job / queue-entry mappings. */
import type { JobStatus, QueueEntry } from "../../adapters/capture-queue.ts";
import { attemptRowId } from "../../models/capture-job.ts";
import type { CaptureJobRow } from "../../schema/capture-job.ts";
import type { DatabaseJob, QueueJobInput } from "./types.ts";

/** What the `payload` column holds. */
interface StoredPayload {
  reqId?: string;
  traceparent?: string;
  data?: Record<string, unknown>;
}

/** Serialize the request id, trace context and kind-specific fields of a job; null when empty. */
export function encodePayload(job: QueueJobInput): string | null {
  const stored: StoredPayload = {};
  if (job.reqId !== undefined) {
    stored.reqId = job.reqId;
  }
  if (job.traceparent !== undefined) {
    stored.traceparent = job.traceparent;
  }
  if (job.data !== undefined && Object.keys(job.data).length > 0) {
    stored.data = job.data;
  }
  return Object.keys(stored).length === 0 ? null : JSON.stringify(stored);
}

/** Parse a stored payload. A malformed one (a poison row) decodes as empty rather than throwing. */
export function decodePayload(raw: string | null): StoredPayload {
  if (raw === null || raw === "") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? pickPayload(parsed) : {};
  } catch {
    return {};
  }
}

/** The job handed to a consumer for attempt `attempt` of a job row. */
export function toDatabaseJob(row: CaptureJobRow, attempt: number, leaseMs: number): DatabaseJob {
  const payload = decodePayload(row.payload);
  const job: DatabaseJob = {
    buildId: row.buildId ?? "",
    jobId: row.jobId,
    kind: row.kind,
    attempt,
    attempts: attempt - 1,
    maxAttempts: row.maxAttempts,
    receipt: attemptRowId(row.jobId, attempt),
    leaseMs,
    data: payload.data ?? {},
  };
  return withOptional(job, row, payload);
}

/** The queue-view entry of a job row. */
export function toQueueEntry(row: CaptureJobRow): QueueEntry {
  const entry: QueueEntry = {
    buildId: row.buildId ?? "",
    status: entryStatus(row.status),
    queuedAt: row.createdAt,
  };
  if (row.shardId !== null) {
    entry.shard = row.shardId;
  }
  if (row.startedAt !== null) {
    entry.startedAt = row.startedAt;
  }
  if (row.finishedAt !== null) {
    entry.finishedAt = row.finishedAt;
  }
  if (row.error !== null) {
    entry.error = row.error;
  }
  return entry;
}

function withOptional(job: DatabaseJob, row: CaptureJobRow, payload: StoredPayload): DatabaseJob {
  if (row.shardId !== null) {
    job.shard = row.shardId;
  }
  if (payload.reqId !== undefined) {
    job.reqId = payload.reqId;
  }
  if (payload.traceparent !== undefined) {
    job.traceparent = payload.traceparent;
  }
  return job;
}

function entryStatus(status: CaptureJobRow["status"]): JobStatus {
  if (status === "done") {
    return "completed";
  }
  if (status === "expired") {
    return "failed";
  }
  return status;
}

function pickPayload(parsed: Record<string, unknown>): StoredPayload {
  const stored: StoredPayload = {};
  if (typeof parsed["reqId"] === "string") {
    stored.reqId = parsed["reqId"];
  }
  if (typeof parsed["traceparent"] === "string") {
    stored.traceparent = parsed["traceparent"];
  }
  if (isRecord(parsed["data"])) {
    stored.data = parsed["data"];
  }
  return stored;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
