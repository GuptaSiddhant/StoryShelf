/** Browser lifecycle and active-run tracking for Playwright. */

import {
  RenderRuns,
  type HeldConnection,
  type RemoteLeaseOutcome,
} from "@storyshelf/core/adapter/capture-runner";
import type { Browser } from "playwright-core";
import type { ActiveRun } from "./types.ts";

/** Tracks in-flight renders, each by its own handle, so `cancel` aborts exactly the runs it names. */
export const activeRuns = new RenderRuns<ActiveRun>();

/** The lease each remote browser holds, released when the browser is closed. */
const leases = new WeakMap<Browser, HeldConnection>();

/** Tie a lease to the browser opened over it: closing the browser through this module releases it. */
export function holdLease(browser: Browser, lease: HeldConnection): void {
  leases.set(browser, lease);
}

/** Close a browser if present, for a cancel (its lease is released as such); never throws. */
export async function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return;
  await tryCloseBrowser(browser, "cancelled");
}

async function tryCloseBrowser(browser: Browser, outcome: RemoteLeaseOutcome): Promise<void> {
  try {
    await browser.close();
  } catch {
    // The run's own `finally` performs final cleanup; cancel must never throw.
  }
  // The first outcome wins: a render cancelled mid-way closes its browser as `cancelled` first.
  await leases.get(browser)?.end(outcome);
}

/** The outcome a render's `finally` reports: a cancel wins over a failure, a failure over a finish. */
export function outcomeOf(active: { cancelled: boolean }, failed: boolean): RemoteLeaseOutcome {
  if (active.cancelled) return "cancelled";
  return failed ? "failed" : "finished";
}

/** Run `work`, then `finish` with whether it threw, so a browser is closed with how its run went. */
export async function finishing<T>(
  work: () => Promise<T>,
  finish: (failed: boolean) => Promise<void>,
): Promise<T> {
  let failed = false;
  try {
    return await work();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await finish(failed);
  }
}

/** Best-effort close for the render's `finally` block. */
export async function safeCloseBrowser(
  browser: Browser,
  outcome: RemoteLeaseOutcome = "finished",
): Promise<void> {
  await tryCloseBrowser(browser, outcome);
}

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
