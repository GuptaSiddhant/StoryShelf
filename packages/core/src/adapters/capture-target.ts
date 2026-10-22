/**
 * Capture targets (ADR 0007, decision 3): what a project names to render on. A target is a rendering
 * engine (`chromium`) or a remote one, `<engine>@<name>` (`chromium@grid`), which has its own
 * baselines and fingerprint.
 */

/** A rendering engine. */
export type BrowserName = "chromium" | "firefox" | "webkit" | "chrome";

/** Engine names accepted for capture rendering (Chromium default). */
export const BROWSER_NAMES = ["chromium", "firefox", "webkit", "chrome"] as const;

/** Engine that legacy rows and single-browser projects belong to. */
export const DEFAULT_BROWSER: BrowserName = "chromium";

/** What a project's `browsers` setting, a snapshot's `browser` and a baseline key hold. */
export type CaptureTarget = BrowserName | `${BrowserName}@${string}`;

/** Remote target names: they become part of a storage key and a unique index. */
export const TARGET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/u;

/** How a runner's browser reaches the Storybook (ADR 0007, decision 5). */
export type TargetReach = "loopback" | "url";

/** Whether a target can render now; `unavailable` carries the reason shown to operators. */
export type TargetStatus = "ready" | { readonly unavailable: string };

/** One target a runner offers, in its metadata. */
export interface RunnerTarget {
  target: CaptureTarget;
  reach: TargetReach;
  status: TargetStatus;
}

/** A target split into its engine and, for a remote one, its name. */
export interface ParsedTarget {
  engine: BrowserName;
  /** Set for `<engine>@<name>`; absent for a local engine. */
  name?: string;
}

/** Whether `value` is an engine name. */
export function isBrowserName(value: unknown): value is BrowserName {
  return typeof value === "string" && (BROWSER_NAMES as readonly string[]).includes(value);
}

/** Split a target into engine and name; `null` when it is not a valid target. */
export function tryParseTarget(value: unknown): ParsedTarget | null {
  if (typeof value !== "string") {
    return null;
  }
  const at = value.indexOf("@");
  const engine = at === -1 ? value : value.slice(0, at);
  if (!isBrowserName(engine)) {
    return null;
  }
  if (at === -1) {
    return { engine };
  }
  const name = value.slice(at + 1);
  return TARGET_NAME_PATTERN.test(name) ? { engine, name } : null;
}

/** Split a target into engine and name; throws on anything that is not a target. */
export function parseTarget(value: string): ParsedTarget {
  const parsed = tryParseTarget(value);
  if (parsed === null) {
    throw new Error(
      `Invalid capture target "${value}": expected one of ${BROWSER_NAMES.join(", ")}, or <engine>@<name> with a lowercase name of at most 32 letters, digits and hyphens`,
    );
  }
  return parsed;
}

/** Whether `value` is a capture target. */
export function isCaptureTarget(value: unknown): value is CaptureTarget {
  return tryParseTarget(value) !== null;
}

/** The engine half of a target. */
export function engineOf(target: CaptureTarget): BrowserName {
  return parseTarget(target).engine;
}

/** The reason a status is unavailable, or `null` when it is ready. */
export function unavailableReason(status: TargetStatus): string | null {
  return status === "ready" ? null : status.unavailable;
}

/**
 * A launch or connect failure: the browser never started, so the job fails at once with this
 * reason. Crash isolation (`capture/isolate.ts`) must not see it, since no story is at fault
 * (ADR 0007, decision 7).
 */
export class TargetLaunchError extends Error {
  override readonly name = "TargetLaunchError";
  readonly target: CaptureTarget;
  /** Why it did not start, without the target's name. */
  readonly reason: string;
  /**
   * The failure may pass (a remote browser service that is down or full): the target is not marked
   * unavailable for it, though the job still fails at once. A wrong version or credentials do not.
   */
  readonly transient: boolean;

  constructor(
    target: CaptureTarget,
    reason: string,
    options?: { cause?: unknown; transient?: boolean },
  ) {
    super(`Cannot launch ${target}: ${reason}`, options);
    this.target = target;
    this.reason = reason;
    this.transient = options?.transient ?? false;
  }
}
