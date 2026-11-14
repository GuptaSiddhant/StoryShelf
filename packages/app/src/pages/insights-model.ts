import type { QueueView } from "./compute-jobs.tsx";

/** Capture timings of a build, from the milliseconds the renderer reported per snapshot. */
export interface CaptureTimings {
  /** Snapshots that reported a duration. */
  measured: number;
  averageMs: number;
  /** The 95th percentile: 19 in 20 captures were faster. */
  p95Ms: number;
  slowestMs: number;
}

/** Nearest-rank percentile of an ascending list. */
function percentile(sorted: readonly number[], fraction: number): number {
  const rank = Math.ceil(sorted.length * fraction);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0;
}

/** Timings over the snapshots that report a duration; null when none does (inherited or not yet captured). */
export function captureTimingsOf(
  snapshots: readonly { durationMs: number | null }[],
): CaptureTimings | null {
  const durations = snapshots
    .flatMap((snapshot) => (snapshot.durationMs === null ? [] : [snapshot.durationMs]))
    .toSorted((a, b) => a - b);
  if (durations.length === 0) {
    return null;
  }
  const total = durations.reduce((sum, ms) => sum + ms, 0);
  return {
    measured: durations.length,
    averageMs: Math.round(total / durations.length),
    p95Ms: percentile(durations, 0.95),
    slowestMs: durations.at(-1) ?? 0,
  };
}

/** A duration for people: `850 ms`, `4.2 s`, `2 min 5 s`. */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  const minutes = Math.floor(ms / 60_000);
  return `${minutes} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/**
 * The queue entries of the builds in `owned`, in the shape the jobs card shows. The capture queue is
 * shared by every project, so a project's view must never include another project's builds.
 */
export function queueViewOf(
  entries: readonly QueueView[],
  owned: ReadonlySet<string>,
): QueueView[] {
  return entries
    .filter((entry) => owned.has(entry.buildId))
    .map((entry) => ({
      buildId: entry.buildId,
      status: entry.status,
      queuedAt: entry.queuedAt,
      startedAt: entry.startedAt,
      finishedAt: entry.finishedAt,
      error: entry.error,
    }));
}

/** What the project's live published content weighs; `unsized` blobs were recorded before sizes were kept. */
export interface StorageUsageView {
  bytes: number;
  /** Distinct blobs with a recorded size. */
  blobs: number;
  /** Distinct blobs with no recorded size: counted, but not in `bytes`. */
  unsized: number;
}

const BYTE_UNITS = ["KB", "MB", "GB", "TB"] as const;

/** A size for people in decimal units: `0 B`, `812 B`, `4.2 KB`, `1.2 GB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) {
    return `${Math.max(0, Math.round(bytes))} B`;
  }
  let value = bytes;
  let unit = "B";
  for (const next of BYTE_UNITS) {
    if (value < 1000) break;
    value /= 1000;
    unit = next;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}
