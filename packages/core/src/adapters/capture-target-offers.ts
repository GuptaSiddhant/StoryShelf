/**
 * What a runner offers right now, shared by the runners (ADR 0007): the targets it declared, whether
 * each can render, and the lifecycle that keeps that honest. A launch failure marks its target
 * unavailable from then on.
 */
import { TargetLaunchError, type CaptureTarget, type RunnerTarget } from "./capture-target.ts";
import type { AdapterLifecycle } from "./metadata.ts";

/** A runner's live target list. */
export interface TargetOffers {
  /** First declared target: what a project with no `browsers` setting resolves to. */
  readonly defaultTarget: CaptureTarget;
  /** The targets with their current status; reads `metadata.targets`. */
  current(): readonly RunnerTarget[];
  /**
   * Wrap `launch` so a target the runner does not offer fails with a {@link TargetLaunchError}, and
   * a launch that fails marks its target unavailable with the launch error as the reason.
   */
  guard<T>(launch: (target: CaptureTarget) => Promise<T>): (target: CaptureTarget) => Promise<T>;
  /** Lifecycle whose `setup` replaces the statuses with what `verify` finds, and `health` reports them. */
  lifecycle(verify: () => Promise<readonly RunnerTarget[]>): AdapterLifecycle;
}

/**
 * Offer `declared`, default first. Until verified every target reads as ready, so a runner used
 * without `lifecycle.setup` behaves as before and a failed launch still marks its target.
 */
export function createTargetOffers(declared: readonly RunnerTarget[]): TargetOffers {
  let targets: readonly RunnerTarget[] = declared;
  const first = declared[0];
  if (first === undefined) {
    throw new Error("A runner must offer at least one target");
  }
  const fail = (target: CaptureTarget, reason: string): void => {
    targets = targets.map((entry) =>
      entry.target === target ? { ...entry, status: { unavailable: reason } } : entry,
    );
  };
  return {
    defaultTarget: first.target,
    current: () => targets,
    guard: (launch) => async (target) => {
      if (!targets.some((entry) => entry.target === target)) {
        throw new TargetLaunchError(target, "not offered by this runner");
      }
      try {
        return await launch(target);
      } catch (error) {
        if (error instanceof TargetLaunchError) {
          fail(target, error.reason);
        }
        throw error;
      }
    },
    lifecycle: (verify) => ({
      setup: async () => {
        targets = await verify();
      },
      teardown: async () => {
        await Promise.resolve();
      },
      health: async () => {
        await Promise.resolve();
        const down = targets.flatMap((entry) =>
          entry.status === "ready" ? [] : [`${entry.target}: ${entry.status.unavailable}`],
        );
        return {
          ok: down.length < targets.length,
          ...(down.length > 0 ? { detail: down.join("; ") } : {}),
        };
      },
    }),
  };
}
