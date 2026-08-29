/** Lifecycle status of a capture job. */
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** Runs and cancels asynchronous capture jobs for builds. */
export interface CaptureRunner {
  /** Start (or enqueue) capture for a build. */
  run(buildId: string, reqId?: string): Promise<void>;
  /** Cancel a pending or in-flight capture for a build. */
  cancel(buildId: string): Promise<void>;
}
