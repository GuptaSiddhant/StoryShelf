/** Recovery for an in-process capture whose progress lease expired. */
import type { CaptureRunner } from "@storyshelf/core/adapter/capture-runner";
import { recoverStalledCapture } from "@storyshelf/core/capture";
import type { RecoveryDeps } from "@storyshelf/core/capture";
import type { Logger } from "@storyshelf/core/logger";

/** Longest an in-process capture may go without progress before it counts as stalled. */
export const CAPTURE_LEASE_MS = 10 * 60 * 1000;

/** How long a cancelled capture gets to unwind on its own before recovery steps in. */
export const STALL_GRACE_MS = 30 * 1000;

/** Dependencies for {@link createStalledHandler}. */
export interface StalledHandlerDeps {
  runner: Pick<CaptureRunner, "cancel">;
  recovery: RecoveryDeps;
  logger: Logger;
  graceMs?: number;
}

/**
 * Handler for `InMemoryCaptureQueue.onStalled`: cancel the render, give it a grace period to end
 * (it then fails the build through the normal path), and if the build is still `capturing`
 * afterwards recover it with the restart policy: requeue once, then fail.
 */
export function createStalledHandler(
  deps: StalledHandlerDeps,
): (job: { buildId: string }, run: { settled: Promise<void> }) => Promise<void> {
  return async (job, run) => {
    await deps.runner.cancel(job.buildId).catch((error: unknown) => {
      deps.logger.warn({ err: error, buildId: job.buildId }, "cancelling stalled capture failed");
    });
    await Promise.race([run.settled, delay(deps.graceMs ?? STALL_GRACE_MS)]);
    const outcome = await recoverStalledCapture(deps.recovery, job.buildId);
    deps.logger.warn({ buildId: job.buildId, outcome }, "stalled capture handled");
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}
