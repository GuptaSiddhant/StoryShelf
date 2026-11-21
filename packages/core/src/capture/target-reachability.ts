/**
 * Whether each capture target can be reached, measured from launch outcomes (ADR 0007, decision 7).
 * A launch or connect failure marks the target unreachable with the time and a fixed reason class;
 * the next success clears it. Held in memory per runner, so no schema change. Only a transition
 * reports, so a run of failed builds raises one alert, not one per build. The record never holds
 * an endpoint, header, lease or the provider's text: only the class.
 */
import {
  isCaptureTarget,
  TargetLaunchError,
  type CaptureTarget,
} from "../adapters/capture-target.ts";

/** Why a target is unreachable, as a class: never the provider's own text. */
export type UnreachableReason = "connection" | "not-installed" | "launch";

/** A target that cannot be reached, and since when. */
export interface UnreachableTarget {
  reason: UnreachableReason;
  /** ISO-8601 time of the first failure of this outage. */
  since: string;
}

/** A transition worth telling an admin about. */
export type ReachabilityChange =
  | { kind: "unreachable"; target: CaptureTarget; reason: UnreachableReason; since: string }
  | { kind: "recovered"; target: CaptureTarget; since: string };

/** The class of a failure's reason text (the text itself is dropped). */
export function reasonClassOf(reason: string): UnreachableReason {
  if (/executable|not installed|not offered|does not exist/iu.test(reason)) {
    return "not-installed";
  }
  if (
    /unavailable|connect|websocket|timed? ?out|refused|econn|enotfound|\b5\d\d\b/iu.test(reason)
  ) {
    return "connection";
  }
  return "launch";
}

const LAUNCH_MESSAGE = /^Cannot launch (\S+): ([\s\S]*)$/u;

/**
 * The target and reason class of a launch failure. A forked capture child reports only the
 * message, so that form is read too.
 */
export function launchFailureOf(
  error: unknown,
): { target: CaptureTarget; reason: UnreachableReason } | null {
  if (error instanceof TargetLaunchError) {
    return { target: error.target, reason: reasonClassOf(error.reason) };
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const match = LAUNCH_MESSAGE.exec(message);
  const target = match?.[1];
  return match !== null && isCaptureTarget(target)
    ? { target, reason: reasonClassOf(match[2] ?? "") }
    : null;
}

/** Per-runner reachability, with a hook for the transitions. */
export class TargetReachability {
  readonly #down = new Map<CaptureTarget, UnreachableTarget>();
  readonly #now: () => Date;
  /** Called on each transition; a throw is the caller's to handle. */
  onChange: ((change: ReachabilityChange) => Promise<void> | void) | undefined;

  constructor(now: () => Date = (): Date => new Date()) {
    this.#now = now;
  }

  /** Record a launch failure; the first of an outage reports, the rest only keep the record. */
  async failed(target: CaptureTarget, reason: UnreachableReason): Promise<void> {
    if (this.#down.has(target)) {
      return;
    }
    const since = this.#now().toISOString();
    this.#down.set(target, { reason, since });
    await this.onChange?.({ kind: "unreachable", target, reason, since });
  }

  /** Record a launch that worked; reports only when the target was unreachable. */
  async succeeded(target: CaptureTarget): Promise<void> {
    const was = this.#down.get(target);
    if (was === undefined) {
      return;
    }
    this.#down.delete(target);
    await this.onChange?.({ kind: "recovered", target, since: was.since });
  }

  /** The unreachable targets now. */
  unreachable(): ReadonlyMap<CaptureTarget, UnreachableTarget> {
    return this.#down;
  }
}

const byOwner = new WeakMap<object, TargetReachability>();

/** The reachability record of a runner (or any owner object), created on first use. */
export function reachabilityOf(owner: object): TargetReachability {
  let found = byOwner.get(owner);
  if (found === undefined) {
    found = new TargetReachability();
    byOwner.set(owner, found);
  }
  return found;
}
