/**
 * Capture target reachability in the app (ADR 0007, decision 7): the capture handler reports each
 * launch outcome to the runner's {@link TargetReachability}, and a change alerts admins once.
 * Recorded here, in the parent, so a forked child's failures count the same as in-process ones.
 * Nothing but the target name, a reason class and a time leaves this module.
 */
import { isCaptureTarget, type CaptureTarget } from "@storyshelf/core/adapter/capture-runner";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import {
  launchFailureOf,
  type ReachabilityChange,
  type TargetReachability,
} from "@storyshelf/core/capture";
import type { Logger } from "@storyshelf/core/logger";
import { SnapshotModel } from "@storyshelf/core/models";
import type { CaptureHandler } from "./capture-handlers.ts";

/** The targets a build rendered on: they were reachable. */
export async function renderedTargets(
  db: DatabaseAdapter,
  buildId: string,
): Promise<CaptureTarget[]> {
  const snapshots = await new SnapshotModel(db).listByBuildSummary(buildId);
  const seen = new Set<CaptureTarget>();
  for (const snapshot of snapshots) {
    if (isCaptureTarget(snapshot.browser)) {
      seen.add(snapshot.browser);
    }
  }
  return [...seen];
}

/**
 * Report each run's launch outcome: a launch failure marks its target unreachable, a run that
 * ended marks every target it rendered on reachable. A failing reporter never changes the run.
 */
export function reportingReachability(
  inner: CaptureHandler,
  reach: TargetReachability,
  db: DatabaseAdapter,
  logger: Logger,
): CaptureHandler {
  const safely = async (work: () => Promise<void>): Promise<void> => {
    try {
      await work();
    } catch (err) {
      logger.warn({ err }, "recording target reachability failed");
    }
  };
  return {
    ...inner,
    accepts: (job) => inner.accepts?.(job) !== false,
    run: async (job, context) => {
      // The outages this run started with: one recorded meanwhile by an overlapping run is newer.
      const started = new Map(reach.unreachable());
      try {
        await inner.run(job, context);
      } catch (error) {
        const failure = launchFailureOf(error);
        if (failure !== null) {
          await safely(async () => {
            await reach.failed(failure.target, failure.reason);
          });
        }
        throw error;
      }
      await safely(async () => {
        const targets = await renderedTargets(db, job.buildId);
        await Promise.all(
          targets.map(async (target) => {
            await reach.succeeded(target, started);
          }),
        );
      });
    },
  };
}

/** The data of an alert: the target, the class and the time, never a connection detail. */
export function alertDataOf(change: ReachabilityChange): Record<string, unknown> {
  return change.kind === "unreachable"
    ? { target: change.target, reason: change.reason, since: change.since }
    : { target: change.target, since: change.since };
}
