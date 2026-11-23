/** What the consumer does before it polls: sweep the scratch a killed run left. */
import type { Logger } from "../../logger.ts";
import { sweepOrphanedScratch } from "../../publish/scratch.ts";

/** Sweep scratch left by a killed run; failures are logged, never fatal. */
export async function sweepScratch(scratchDir: string | undefined, logger: Logger): Promise<void> {
  if (scratchDir === undefined) {
    return;
  }
  try {
    await sweepOrphanedScratch(scratchDir, { logger });
  } catch (error) {
    logger.warn({ err: error }, "scratch sweep failed");
  }
}
