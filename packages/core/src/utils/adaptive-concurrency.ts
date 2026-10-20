/** Adaptive page concurrency: raise while capture stays healthy, back off when it does not. */
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Logger } from "../logger.ts";

/** Tuning for {@link AdaptiveConcurrency}. */
export interface AdaptiveOptions {
  /** Starting in-flight limit. */
  initial: number;
  /** Lowest limit (default 1). */
  min?: number;
  /** Highest limit. */
  max: number;
  /** Event-loop lag p99 (ms) since the previous reading; defaults to a `perf_hooks` histogram. */
  readLagMs?: () => number;
  /** p95 latency may grow this much over the first window before the window counts as unhealthy (default 1.25). */
  latencyTolerance?: number;
  /** Event-loop lag p99 above this (ms) counts as unhealthy (default 100). */
  lagLimitMs?: number;
  /** Windows to hold after a timeout back-off before raising again (default 3). */
  holdWindows?: number;
  /** Scoped logger; every limit change is logged with its reason. */
  logger?: Logger;
}

/** What one finished capture reports. */
export interface Observation {
  durationMs: number;
  /** The capture hit a navigation/action timeout. */
  timedOut?: boolean;
}

const MIN_WINDOW = 8;

/**
 * AIMD controller over the number of pages rendering at once.
 *
 * Captures are grouped in windows (at least 8, or two per slot). A window with any timeout halves
 * the limit and holds it there for a few windows; a window whose p95 latency grew more than the
 * tolerance over the first window, or whose event-loop lag p99 is high, lowers it by one; a healthy
 * window raises it by one. The first window without timeouts sets the latency baseline, so it only
 * ever holds.
 */
export class AdaptiveConcurrency {
  private current: number;
  private readonly min: number;
  private readonly max: number;
  private readonly options: AdaptiveOptions;
  private window: Observation[] = [];
  private baselineP95: number | null = null;
  private hold = 0;
  private readonly lag: { read: () => number; stop: () => void };

  constructor(options: AdaptiveOptions) {
    this.options = options;
    this.min = Math.max(1, Math.floor(options.min ?? 1));
    this.max = Math.max(this.min, Math.floor(options.max));
    this.current = clamp(Math.floor(options.initial), this.min, this.max);
    this.lag = options.readLagMs ? { read: options.readLagMs, stop: noop } : eventLoopLagReader();
  }

  /** Pages allowed in flight right now. */
  get limit(): number {
    return this.current;
  }

  /** Record a finished capture; may change {@link limit} at a window boundary. */
  observe(observation: Observation): void {
    this.window.push(observation);
    if (this.window.length >= Math.max(MIN_WINDOW, this.current * 2)) {
      this.closeWindow();
    }
  }

  /** Release the lag monitor. */
  dispose(): void {
    this.lag.stop();
  }

  private closeWindow(): void {
    const samples = this.window;
    this.window = [];
    const stats = {
      p95: percentile(
        samples.map((sample) => sample.durationMs),
        0.95,
      ),
      timeouts: samples.filter((sample) => sample.timedOut).length,
      lagP99: this.lag.read(),
    };
    const from = this.current;
    const verdict = this.judge(stats);
    // A window with a timeout carries the timeout's duration in its p95: never a baseline.
    if (stats.timeouts === 0) {
      this.baselineP95 ??= stats.p95;
    }
    this.current = verdict.halve
      ? Math.max(this.min, Math.floor(from / 2))
      : clamp(from + verdict.delta, this.min, this.max);
    if (this.current !== from) {
      this.options.logger?.info(
        { from, to: this.current, reason: verdict.reason, ...roundedStats(stats) },
        "capture concurrency adjusted",
      );
    }
  }

  /** Decide what a finished window means; updates the post-back-off hold. */
  private judge(window: WindowStats): Verdict {
    if (window.timeouts > 0) {
      this.hold = this.options.holdWindows ?? 3;
      return { delta: 0, halve: true, reason: "timeouts" };
    }
    const slow = this.isSlow(window.p95);
    if (slow || window.lagP99 > (this.options.lagLimitMs ?? 100)) {
      return { delta: -1, halve: false, reason: slow ? "latency" : "event-loop lag" };
    }
    return this.raiseOrHold();
  }

  /** A healthy window: set the baseline, sit out a back-off hold, or raise by one. */
  private raiseOrHold(): Verdict {
    if (this.baselineP95 === null) {
      return { delta: 0, halve: false, reason: "baseline" };
    }
    if (this.hold > 0) {
      this.hold -= 1;
      return { delta: 0, halve: false, reason: "holding after back-off" };
    }
    return { delta: 1, halve: false, reason: "healthy" };
  }

  private isSlow(p95: number): boolean {
    return (
      this.baselineP95 !== null && p95 > this.baselineP95 * (this.options.latencyTolerance ?? 1.25)
    );
  }
}

interface WindowStats {
  p95: number;
  timeouts: number;
  lagP99: number;
}

function roundedStats(stats: WindowStats): Record<string, number> {
  return {
    p95Ms: Math.round(stats.p95),
    lagP99Ms: Math.round(stats.lagP99),
    timeouts: stats.timeouts,
  };
}

interface Verdict {
  delta: number;
  halve: boolean;
  reason: string;
}

/** Whether an error is a navigation/action timeout (Playwright and Puppeteer both name it `TimeoutError`). */
export function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "TimeoutError" || /\btimed? ?out\b/iu.test(error.message);
}

function noop(): void {}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function percentile(values: number[], fraction: number): number {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

/** p99 event-loop delay (ms) since the previous read, from a `perf_hooks` histogram. */
function eventLoopLagReader(): { read: () => number; stop: () => void } {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  return {
    read: () => {
      const lag = histogram.percentile(99) / 1e6;
      histogram.reset();
      return lag;
    },
    stop: () => {
      histogram.disable();
    },
  };
}
