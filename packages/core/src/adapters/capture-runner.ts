export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface CaptureRunner {
  run(buildId: string): Promise<void>;
  cancel(buildId: string): Promise<void>;
}
