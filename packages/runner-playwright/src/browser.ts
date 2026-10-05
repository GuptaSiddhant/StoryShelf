/** Browser lifecycle and active-run tracking for Playwright. */

import type { Browser } from "playwright-core";
import type { ActiveRun } from "./types.ts";

/** Tracks in-flight renders so `cancel` can abort them. */
export const activeRuns = new Map<string, ActiveRun>();

/** Close a browser if present; `cancel` must never throw. */
export async function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return;
  await tryCloseBrowser(browser);
}

async function tryCloseBrowser(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } catch {
    // The run's own `finally` performs final cleanup; cancel must never throw.
  }
}

/** Best-effort close for the render's `finally` block. */
export async function safeCloseBrowser(browser: Browser): Promise<void> {
  await tryCloseBrowser(browser);
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
