import type { CaptureJob, CaptureQueue, QueueEntry } from "../adapters/capture-queue.ts";

/** Options for delegating capture jobs to a remote queue service. */
export interface RemoteCaptureQueueOptions {
  /** URL of the remote queue service. */
  url: string;
  /** Authentication token for the remote service. */
  token?: string;
}

/**
 * A remote capture queue implementation for serverless deployments.
 *
 * This is a skeleton implementation that delegates to an external queue service.
 * Production implementations would integrate with SQS, Cloudflare Queues,
 * Azure Storage Queues, or similar services.
 */
export class RemoteCaptureQueue implements CaptureQueue {
  constructor(private readonly options: RemoteCaptureQueueOptions) {}

  async enqueue(job: CaptureJob): Promise<void> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.options.token) {
      headers["Authorization"] = `Bearer ${this.options.token}`;
    }
    const response = await fetch(`${this.options.url}/enqueue`, {
      method: "POST",
      headers,
      body: JSON.stringify(job),
    });
    if (!response.ok) {
      throw new Error(`Failed to enqueue job: ${response.statusText}`);
    }
  }

  async status(buildId: string): Promise<QueueEntry | null> {
    const headers: Record<string, string> = {};
    if (this.options.token) {
      headers["Authorization"] = `Bearer ${this.options.token}`;
    }
    const response = await fetch(`${this.options.url}/status/${buildId}`, { headers });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Failed to get status: ${response.statusText}`);
    }
    return (await response.json()) as QueueEntry;
  }

  async active(): Promise<QueueEntry[]> {
    const headers: Record<string, string> = {};
    if (this.options.token) {
      headers["Authorization"] = `Bearer ${this.options.token}`;
    }
    const response = await fetch(`${this.options.url}/active`, { headers });
    if (!response.ok) {
      throw new Error(`Failed to get active jobs: ${response.statusText}`);
    }
    return (await response.json()) as QueueEntry[];
  }

  async recent(limit: number): Promise<QueueEntry[]> {
    const headers: Record<string, string> = {};
    if (this.options.token) {
      headers["Authorization"] = `Bearer ${this.options.token}`;
    }
    const response = await fetch(`${this.options.url}/recent?limit=${limit}`, { headers });
    if (!response.ok) {
      throw new Error(`Failed to get recent jobs: ${response.statusText}`);
    }
    return (await response.json()) as QueueEntry[];
  }
}
