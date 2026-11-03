/** What a remote target may open, for the run's log (ADR 0007, decision 4): limits only, no endpoints. */
import type { CaptureTarget } from "./capture-target.ts";
import type { RemoteBrowser } from "./remote-browser.ts";

/** Said of every experimental preset until someone verifies it against the provider. */
export const UNVERIFIED_NOTE = "not verified against live infrastructure";

/** The loggable limits of one remote target. A `null` limit is not capped. */
export interface RemoteSizing {
  target: CaptureTarget;
  /** Pages the plan allows at once: the target's page gate. Per target, per process. */
  pages: number | null;
  /** Pages on one connection, when capped. */
  pagesPerConnection: number | null;
  /** Pages one connection can hold: the lower of `pages` and `pagesPerConnection`. */
  effectivePagesPerConnection: number | null;
  /** Connections this process holds at once, when capped. Per process. */
  maxConnections: number | null;
  scope: { pages: "target"; connections: "process" };
  experimental: boolean;
  /** Present only for an experimental preset. */
  verification?: typeof UNVERIFIED_NOTE;
}

/** The configured and effective limits of `remote`, read now (a `sessions` function is live). */
export function remoteSizingOf(target: CaptureTarget, remote: RemoteBrowser): RemoteSizing {
  const pages = pagesOf(remote);
  const perConnection = remote.maxPagesPerConnection ?? null;
  const lowest = [pages, perConnection].filter((value): value is number => value !== null);
  return {
    target,
    pages,
    pagesPerConnection: perConnection,
    effectivePagesPerConnection: lowest.length === 0 ? null : Math.min(...lowest),
    maxConnections: remote.maxConnections ?? null,
    scope: { pages: "target", connections: "process" },
    experimental: remote.experimental,
    ...(remote.experimental ? { verification: UNVERIFIED_NOTE } : {}),
  };
}

/** Log the limits at run start, once per target. */
export function logRemoteSizing(
  logger: { info(fields: object, message: string): void } | undefined,
  target: CaptureTarget,
  remote: RemoteBrowser,
): void {
  logger?.info(remoteSizingOf(target, remote), "remote sizing");
}

/** The page limit now; a `sessions` function that throws or returns nonsense reads as unknown. */
function pagesOf(remote: RemoteBrowser): number | null {
  try {
    const value = typeof remote.sessions === "function" ? remote.sessions() : remote.sessions;
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}
