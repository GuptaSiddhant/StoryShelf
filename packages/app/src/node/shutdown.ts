import type { Logger } from "@storyshelf/core/logger";
import type { ShelfLifecycle } from "../app-types.ts";
import { remainingUntil, within } from "./deadline.ts";
import type { Listener } from "./listener.ts";
import type { ShutdownResult, ShutdownTrigger } from "./types.ts";

/** What one shutdown stops: the listener (when one was opened) and the app. */
export interface ShutdownParts {
  readonly lifecycle: ShelfLifecycle;
  readonly listener: Listener | null;
  readonly timeoutMs: number;
  readonly logger: Logger;
}

type TeardownOutcome = "done" | "timeout" | "failed";

/**
 * The part of what is left of the timeout kept for closing adapters after the job drain: a second,
 * or a quarter of a short budget.
 */
export function closeReserveMs(remainingMs: number): number {
  return Math.min(1000, Math.floor(remainingMs / 4));
}

/**
 * Shut down within `timeoutMs`: requests in flight first (adapters must outlive them; at most half
 * the budget, then their connections are destroyed), then the app's teardown through its own lifecycle, given the rest as the #912 drain's `graceMs` so jobs
 * still running are handed back before the deadline. Resolves by the deadline whatever is stuck.
 */
export async function shutdown(
  parts: ShutdownParts,
  trigger: ShutdownTrigger,
): Promise<ShutdownResult> {
  const startedAt = Date.now();
  const deadline = startedAt + parts.timeoutMs;
  parts.logger.info({ trigger, timeoutMs: parts.timeoutMs }, "StoryShelf shutting down");
  // Requests get at most half the budget, so the job drain and adapter teardown always get the rest.
  const requestsBy = startedAt + Math.floor(parts.timeoutMs / 2);
  const drained = parts.listener ? await parts.listener.drain(requestsBy) : true;
  const teardown = await teardownBy(parts, deadline);
  const result = resultOf(drained, teardown, trigger, Date.now() - startedAt);
  logResult(parts.logger, result);
  return result;
}

/** The app's teardown, bounded by `deadline`; a rejection is logged, never thrown. */
async function teardownBy(parts: ShutdownParts, deadline: number): Promise<TeardownOutcome> {
  const remaining = remainingUntil(deadline);
  const graceMs = remaining - closeReserveMs(remaining);
  const running = parts.lifecycle.teardown({ graceMs }).then(
    (): TeardownOutcome => "done",
    (error: unknown): TeardownOutcome => {
      parts.logger.error({ err: error }, "app teardown failed");
      return "failed";
    },
  );
  return await within(running, remaining, "timeout");
}

function resultOf(
  drained: boolean,
  teardown: TeardownOutcome,
  trigger: ShutdownTrigger,
  durationMs: number,
): ShutdownResult {
  if (drained && teardown === "done") {
    return { complete: true, trigger, durationMs };
  }
  const incomplete = teardown === "failed" ? "teardown-failed" : "timeout";
  return { complete: false, incomplete, trigger, durationMs };
}

function logResult(logger: Logger, result: ShutdownResult): void {
  if (result.complete) {
    logger.info({ trigger: result.trigger, durationMs: result.durationMs }, "shutdown complete");
    return;
  }
  logger.warn(
    { trigger: result.trigger, durationMs: result.durationMs, incomplete: result.incomplete },
    "shutdown incomplete",
  );
}
