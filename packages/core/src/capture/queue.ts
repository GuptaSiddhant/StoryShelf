import type { JobStatus } from "../adapters/capture-runner.ts";

export interface QueueEntry {
  buildId: string;
  status: JobStatus;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export class Queue {
  private readonly entries = new Map<string, QueueEntry>();
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly concurrency: number) {}

  async run<T>(buildId: string, task: () => Promise<T>): Promise<T> {
    const entry = this.track(buildId);
    await this.acquire();
    entry.status = "running";
    entry.startedAt = new Date().toISOString();
    try {
      return await task();
    } catch (error) {
      entry.status = "failed";
      entry.finishedAt = new Date().toISOString();
      entry.error = error instanceof Error ? error.message : "Capture failed";
      throw error;
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
      if (entry.status !== "failed") {
        entry.status = "completed";
        entry.finishedAt = new Date().toISOString();
      }
    }
  }

  status(buildId: string): QueueEntry | null {
    return this.entries.get(buildId) ?? null;
  }

  active(): QueueEntry[] {
    return [...this.entries.values()]
      .filter((entry) => entry.status === "queued" || entry.status === "running")
      .toSorted((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }

  recent(limit: number): QueueEntry[] {
    return [...this.entries.values()].toSorted((a, b) => b.queuedAt.localeCompare(a.queuedAt)).slice(0, limit);
  }

  private track(buildId: string): QueueEntry {
    const existing = this.entries.get(buildId);
    if (existing) {
      existing.status = "queued";
      existing.queuedAt = new Date().toISOString();
      existing.startedAt = undefined;
      existing.finishedAt = undefined;
      existing.error = undefined;
      return existing;
    }
    const entry: QueueEntry = { buildId, status: "queued", queuedAt: new Date().toISOString() };
    this.entries.set(buildId, entry);
    return entry;
  }

  private async acquire(): Promise<void> {
    if (this.running < this.concurrency) {
      this.running += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
    await this.acquire();
  }
}