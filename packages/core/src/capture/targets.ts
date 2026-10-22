/** What a runner offers right now: its declared targets, minus the ones this deployment cannot reach. */
import type { CaptureRunner, RunnerTarget } from "../adapters/capture-runner.ts";

/** What a target that needs a URL depends on. */
export interface TargetPrerequisites {
  /** The resolved public origin (ADR 0007, decision 6); absent while none resolves. */
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
    return { ...entry, status: { unavailable: "no secret" } };
  }
  if (prerequisites.publicOrigin === undefined) {
    return { ...entry, status: { unavailable: "no public origin" } };
  }
  return entry;
}
