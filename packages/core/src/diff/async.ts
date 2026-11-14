/** `diffImagesAsync`: `diffImages` on a lazily created, process-wide worker pool, plus `configureImages`. */
import { availableParallelism } from "node:os";
import type { DiffOptions, DiffResult } from "./options.ts";
import { DiffPool } from "./pool.ts";
import {
  appliedImageSettings,
  configuredThreadCount,
  currentImageEngine,
  type ImageSettings,
  setImageSettings,
} from "./settings.ts";

/** Environment variable overriding the pool size; `0` runs diffs in-thread. */
export const DIFF_WORKERS_ENV = "STORYSHELF_DIFF_WORKERS";

let pool: DiffPool | undefined;

/**
 * Apply `images.engine` and `compare.threads`; both beat their environment variables
 * (`STORYSHELF_IMAGE_ENGINE`, `STORYSHELF_DIFF_WORKERS`). A running pool whose engine or size no
 * longer matches is shut down and rebuilt on next use.
 */
export function configureImages(settings: ImageSettings): void {
  const before = appliedImageSettings();
  setImageSettings(settings);
  const after = appliedImageSettings();
  if (before.engine === after.engine && before.threads === after.threads) {
    return;
  }
  const stale = pool;
  pool = undefined;
  stale?.shutdown().catch(() => {});
}

/**
 * Diff two PNGs without blocking the event loop; same result as `diffImages`.
 *
 * Runs on a shared `worker_threads` pool (`max(1, availableParallelism() - 1)` threads, or
 * `STORYSHELF_DIFF_WORKERS`; `0` means in-thread) and falls back to the in-thread path when
 * threads are unavailable. The buffers may be transferred to a worker, which detaches them in
 * the caller: do not read them afterwards.
 *
 * The pool is process-scoped, not owned by the capture consumer, so the re-diff route benefits
 * even on an instance that never renders.
 */
export async function diffImagesAsync(
  baseline: Buffer,
  current: Buffer,
  options: DiffOptions,
): Promise<DiffResult> {
  pool ??= new DiffPool({
    size: configuredThreadCount() ?? resolveDiffWorkers(process.env),
    workerUrl: defaultWorkerUrl(),
    engine: currentImageEngine(),
  });
  return await pool.run(baseline, current, options);
}

/** Stop the shared pool's workers. A later `diffImagesAsync` starts a fresh pool. */
export async function shutdownDiffPool(): Promise<void> {
  const current = pool;
  pool = undefined;
  await current?.shutdown();
}

/** Pool size from the environment: a non-negative integer, else one fewer than the CPU count (min 1). */
export function resolveDiffWorkers(
  env: Record<string, string | undefined>,
  parallelism: number = availableParallelism(),
): number {
  const raw = env[DIFF_WORKERS_ENV]?.trim();
  if (raw && /^\d+$/u.test(raw)) {
    return Number(raw);
  }
  return Math.max(1, parallelism - 1);
}

/** `worker.mjs` beside the built output; `worker.ts` when running from source (tests, `nub run serve`). */
function defaultWorkerUrl(): URL {
  return import.meta.url.endsWith(".ts")
    ? new URL("worker.ts", import.meta.url)
    : new URL("worker.mjs", import.meta.url);
}
