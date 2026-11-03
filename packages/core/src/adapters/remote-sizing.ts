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

/** What the runner actually enforces, so the effective limit is not overstated. */
export interface RemoteSizingEnforced {
  /** The shared page gate of the target; its size is the effective page limit. */
  gate?: { readonly size: number } | undefined;
  /** The run's configured page concurrency, when set. */
  concurrency?: number | undefined;
  /** Whether the runner applies `maxPagesPerConnection` (default true). */
  pagesPerConnection?: boolean | undefined;
}

/** The configured and effective limits of `remote`, as far as the runner enforces them. */
export function remoteSizingOf(
  target: CaptureTarget,
  remote: RemoteBrowser,
  enforced: RemoteSizingEnforced = {},
): RemoteSizing {
  const pages = enforced.gate === undefined ? pagesOf(remote) : gatePagesOf(enforced.gate);
  const perConnection = remote.maxPagesPerConnection ?? null;
  const limits = [
    pages,
    enforced.pagesPerConnection === false ? null : perConnection,
    enforced.concurrency ?? null,
  ].filter((value): value is number => value !== null);
  return {
    target,
    pages,
    pagesPerConnection: perConnection,
    effectivePagesPerConnection: limits.length === 0 ? null : Math.min(...limits),
    maxConnections: remote.maxConnections ?? null,
    scope: { pages: "target", connections: "process" },
    experimental: remote.experimental === true,
    ...(remote.experimental === true ? { verification: UNVERIFIED_NOTE } : {}),
  };
}

/** Log the limits at run start, before any connection is attempted. */
export function logRemoteSizing(
  logger: { info(fields: object, message: string): void } | undefined,
  target: CaptureTarget,
  remote: RemoteBrowser,
  enforced?: RemoteSizingEnforced,
): void {
  logger?.info(remoteSizingOf(target, remote, enforced), "remote sizing");
}

/** The shared gate's cap; a `sessions` callback that throws reads as unknown. */
function gatePagesOf(gate: { readonly size: number }): number | null {
  try {
    return gate.size;
  } catch {
    return null;
  }
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
