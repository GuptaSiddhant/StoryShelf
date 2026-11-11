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
