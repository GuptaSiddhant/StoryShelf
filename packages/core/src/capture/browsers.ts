/** Which capture targets a project renders on, and the guards around that list (ADR 0007). */
import {
  DEFAULT_BROWSER,
  isCaptureTarget,
  unavailableReason,
  type CaptureTarget,
  type RunnerTarget,
} from "../adapters/capture-target.ts";

/** Upper bound on targets per project (each multiplies render time). */
export const MAX_BROWSERS = 3;

/** Parse the project's JSON `browsers` column; `null` when unset or malformed. */
export function parseBrowsers(raw: string | null | undefined): CaptureTarget[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((entry) => isCaptureTarget(entry))
      ? dedupe(parsed)
      : null;
  } catch {
    return null;
  }
}

/**
 * Targets to capture, primary first: the project's `browsers` list, else its single `browser`.
 * Throws when the list exceeds {@link MAX_BROWSERS}.
 */
export function resolveBrowsers(project: {
  browser?: string | undefined;
  browsers?: string | null | undefined;
}): CaptureTarget[] {
  const listed = parseBrowsers(project.browsers);
  const single = isCaptureTarget(project.browser) ? project.browser : DEFAULT_BROWSER;
  const browsers = listed && listed.length > 0 ? listed : [single];
  assertBrowserCount(browsers);
  return browsers;
}

/** Throw when more than {@link MAX_BROWSERS} targets are requested. */
export function assertBrowserCount(browsers: readonly string[]): void {
  if (browsers.length > MAX_BROWSERS) {
    throw new Error(`At most ${MAX_BROWSERS} browsers are supported (got ${browsers.length})`);
  }
}

/**
 * Why `target` cannot render on a runner offering `offered`: it is not on the list, or it is and is
 * unavailable. `null` when it can, and always when the runner publishes no list.
 */
export function refusalFor(
  target: CaptureTarget,
  offered?: readonly RunnerTarget[],
): string | null {
  if (offered === undefined) {
    return null;
  }
  const entry = offered.find((candidate) => candidate.target === target);
  if (entry === undefined) {
    return `${target} is not offered by this capture runner (offered: ${listTargets(offered)})`;
  }
  const reason = unavailableReason(entry.status);
  return reason === null ? null : `${target} is unavailable: ${reason}`;
}

/** The targets of `offered`, for messages; `none` for an empty list. */
export function listTargets(offered: readonly RunnerTarget[]): string {
  return offered.length > 0 ? offered.map((entry) => entry.target).join(", ") : "none";
}

/** Throw, naming every refusal, when the runner cannot render one of `targets`. */
export function assertSupportedBrowsers(
  targets: readonly CaptureTarget[],
  offered?: readonly RunnerTarget[],
): void {
  const refusals = targets.flatMap((target) => refusalFor(target, offered) ?? []);
  if (refusals.length > 0) {
    throw new Error(`Capture runner cannot render: ${refusals.join("; ")}`);
  }
}

function dedupe(browsers: CaptureTarget[]): CaptureTarget[] {
  return [...new Set(browsers)];
}
