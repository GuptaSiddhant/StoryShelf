/** Active-run tracking and best-effort cleanup helpers for Puppeteer. */

import { RenderRuns, type RemoteLeaseOutcome } from "@storyshelf/core/adapter/capture-runner";
import type { ActiveRun } from "./types.ts";
import type { BrowserSession } from "./session.ts";

/** Tracks in-flight renders, each by its own handle, so `cancel` aborts exactly the runs it names. */
export const activeRuns = new RenderRuns<ActiveRun>();

/** The outcome a render's `finally` reports: a cancel wins over a failure, a failure over a finish. */
export function outcomeOf(active: { cancelled: boolean }, failed: boolean): RemoteLeaseOutcome {
  if (active.cancelled) return "cancelled";
  return failed ? "failed" : "finished";
}

/** Run `work`, then `finish` with whether it threw, so a browser is released with how its run went. */
export async function finishing<T>(
  work: () => Promise<T>,
  finish: (failed: boolean, error?: unknown) => Promise<void>,
): Promise<T> {
  let failure: { error: unknown } | undefined;
  try {
    return await work();
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    await finish(failure !== undefined, failure?.error);
  }
}

/** Best-effort close for the static server. */
export async function safeCloseServer(server: { close(): Promise<void> }): Promise<void> {
  try {
    await server.close();
  } catch {
    // Best-effort; teardown must never mask a render result.
  }
}

/** Release and throw when the run was cancelled while acquiring the browser. */
export async function abortIfCancelled(
  active: { cancelled: boolean; session: BrowserSession | null },
  session: BrowserSession,
): Promise<void> {
  if (!active.cancelled) return;
  await session.release("cancelled");
  if (active.session === session) active.session = null;
  throw new Error("Capture cancelled");
}

/** Normalize any thrown value to a string. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
