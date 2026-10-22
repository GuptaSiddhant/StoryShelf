/** What a runner offers right now: its declared targets, minus the ones this deployment cannot reach. */
import type { CaptureRunner, RunnerTarget } from "../adapters/capture-runner.ts";

/** Why a `reach: "url"` target is unavailable without a secret (the first words are matched by tests and docs). */
export const NO_SECRET_REASON =
  "no secret: set the server secret, it signs the Storybook URL the remote browser opens";

/** Why it is unavailable without a confirmed public origin. */
export const NO_ORIGIN_REASON =
  "no public origin: set PUBLIC_BASE_URL, or confirm the detected origin on the System page";

/** What a target that needs a URL depends on. */
export interface TargetPrerequisites {
  /** The confirmed public origin (ADR 0007, decision 6); absent while none is confirmed. */
  publicOrigin: string | undefined;
  /** Whether the server has a `secret` to sign Storybook URLs with. */
  hasSecret: boolean;
}

/**
 * The runner's targets with `reach: "url"` ones marked `unavailable` while they lack a `secret` or a
 * public origin (ADR 0007), so a settings save refuses them and a build fails at once with the
 * reason. `undefined` when the runner publishes no list (it offers any target).
 */
export function offeredTargets(
  runner: Pick<CaptureRunner, "metadata">,
  prerequisites: TargetPrerequisites,
): readonly RunnerTarget[] | undefined {
  return runner.metadata.targets?.map((entry) => withPrerequisites(entry, prerequisites));
}

function withPrerequisites(entry: RunnerTarget, prerequisites: TargetPrerequisites): RunnerTarget {
  if (entry.reach !== "url" || entry.status !== "ready") {
    return entry;
  }
  if (!prerequisites.hasSecret) {
    return { ...entry, status: { unavailable: NO_SECRET_REASON } };
  }
  if (prerequisites.publicOrigin === undefined) {
    return { ...entry, status: { unavailable: NO_ORIGIN_REASON } };
  }
  return entry;
}
