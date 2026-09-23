import type { JobStatus } from "../adapters/capture-queue.ts";

/** A capture attempt row: one queued run of a build's capture pipeline. */
export interface CaptureAttempt {
  id: string;
  projectId: string;
  buildId: string;
  attemptNo: number;
  status: JobStatus;
  error: string | null;
  reqId: string | null;
  storyCount: number;
  failedCount: number;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Log levels stored per capture attempt. */
export type CaptureLogLevel = "debug" | "info" | "warn" | "error";

/** A single log line captured for a build attempt. */
export interface CaptureLog {
  id: string;
  projectId: string;
  buildId: string;
  attemptId: string;
  seq: number;
  level: CaptureLogLevel;
  message: string;
  fields: string | null;
  createdAt: string;
}
