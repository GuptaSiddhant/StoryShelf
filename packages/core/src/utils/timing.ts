/**
 * Per-scope timing recorder: aggregate millisecond sums under shared names.
 *
 * Framework- and telemetry-free (ALS + numbers only) so any host — the Hono
 * app, the remote worker, or a third-party server — can open a scope. The
 * app folds request scopes into `Server-Timing`; background scopes surface
 * as log lines and attempt history. Without an open scope every call is a
 * cheap no-op, keeping unit tests and sleeping workers silent.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** Aggregated durations for one scope (family/phase name → total ms). */
export type TimingMap = Record<string, number>;

const scopes = new AsyncLocalStorage<TimingMap>();

/** Run `fn` with a fresh timing scope, returning its result and aggregates. */
export async function runWithTimings<T>(
  fn: () => T | Promise<T>,
): Promise<{ result: T; timings: TimingMap }> {
  const timings: TimingMap = {};
  const result = await scopes.run(timings, fn);
  return { result, timings };
}

/** Add `durationMs` to `name` in the active scope (no-op when scopeless). */
export function addTiming(name: string, durationMs: number): void {
  const timings = scopes.getStore();
  if (!timings) {
    return;
  }
  timings[name] = (timings[name] ?? 0) + durationMs;
}

/** Run `fn`, recording its wall duration under `name` in the active scope. */
export async function timed<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    addTiming(name, performance.now() - started);
  }
}

/** Copy of aggregates with whole-millisecond values for logs and headers. */
export function roundedTimings(timings: TimingMap): TimingMap {
  return Object.fromEntries(Object.entries(timings).map(([name, ms]) => [name, Math.round(ms)]));
}
