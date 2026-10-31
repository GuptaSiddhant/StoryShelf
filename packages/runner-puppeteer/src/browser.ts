/** Active-run tracking and best-effort server cleanup for Puppeteer. */

import { RenderRuns } from "@storyshelf/core/adapter/capture-runner";
import type { ActiveRun } from "./types.ts";

/** Tracks in-flight renders, each by its own handle, so `cancel` aborts exactly the runs it names. */
export const activeRuns = new RenderRuns<ActiveRun>();

/** Best-effort close for the static server. */
export async function safeCloseServer(server: { close(): Promise<void> }): Promise<void> {
  try {
    await server.close();
  } catch {
    // Best-effort; teardown must never mask a render result.
  }
}

/** Normalize any thrown value to a string. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
