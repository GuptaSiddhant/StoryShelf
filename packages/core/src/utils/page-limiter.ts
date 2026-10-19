/** How many pages a capture run renders at once: fixed when configured, adaptive otherwise. */
import type { Logger } from "../logger.ts";
import { AdaptiveConcurrency } from "./adaptive-concurrency.ts";
import { mapAdaptive } from "./map-adaptive.ts";
import { mapLimit } from "./map-limit.ts";
import { detectResources, maxPageConcurrency, recommendedPageConcurrency } from "./resources.ts";

/** Options for {@link createPageLimiter}. */
export interface PageLimiterOptions {
  /** Explicit page count (config or run input). Fixed: the adaptive controller stays off. */
  concurrency?: number;
  /** Engine being rendered; heavier engines get a smaller budget. */
  browser?: string;
  logger?: Logger;
}

/** Runs capture jobs under a page limit. One limiter spans a whole run so what it learns carries across batches. */
export interface PageLimiter {
  /**
   * Run `fn` over `items`. `fn` resolves to whether the capture timed out (it handles its own
   * failures, so the limiter cannot see them otherwise).
   */
  each<T>(items: readonly T[], fn: (item: T) => Promise<boolean>): Promise<void>;
  /** Release the event-loop monitor. */
  dispose(): void;
}

/**
 * Fixed limit when `concurrency` is given; otherwise start at the CPU/memory/engine-sized
 * recommendation and let latency, event-loop lag and timeouts move it up to the adaptive ceiling.
 */
export function createPageLimiter(options: PageLimiterOptions): PageLimiter {
  if (options.concurrency !== undefined) {
    const limit = options.concurrency;
    return {
      each: async (items, fn) => {
        await mapLimit(items, limit, async (item) => {
          await fn(item);
        });
      },
      dispose: noop,
    };
  }
  const resources = detectResources();
  const controller = new AdaptiveConcurrency({
    initial: recommendedPageConcurrency(resources, options.browser),
    max: maxPageConcurrency(resources, options.browser),
    logger: options.logger,
  });
  return {
    each: async (items, fn) => {
      await mapAdaptive(items, controller, async (item) => ({
        value: undefined,
        timedOut: await fn(item),
      }));
    },
    dispose: () => {
      controller.dispose();
    },
  };
}

function noop(): void {}
