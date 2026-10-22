/**
 * The one entry point for "this build changed, show it" (ADR 0014, decisions 5 and 7). Every build
 * transition and the end of publishing call `request`; it hands each git channel of the project a
 * durable `notify` job, or, on a host with no queue consumer, delivers inline.
 */
import { NotificationChannelModel } from "../../models/notification-channel.ts";
import { sanitizeErrorText } from "../../utils/redact.ts";
import { loadBuild, stateTargets, writeTo } from "./deliver.ts";
import type { BuildStateDeps, BuildStatePublisher, StateTarget } from "./types.ts";

/** What {@link createBuildStatePublisher} needs. */
export interface BuildStatePublisherOptions {
  deps: BuildStateDeps;
  /**
   * Queues a `notify` job. Set when this instance (or another one) consumes the queue; absent, the
   * state is delivered inline in the caller's request, without durability.
   */
  enqueue?: ((job: { channelId: string; buildId: string }) => Promise<void>) | undefined;
}

/** A publisher over `options.deps`. */
export function createBuildStatePublisher(
  options: BuildStatePublisherOptions,
): BuildStatePublisher {
  const { deps } = options;
  return {
    request: async (buildId) => {
      try {
        const loaded = await loadBuild(deps, buildId);
        if (loaded === null) {
          return;
        }
        const targets = await stateTargets(deps, loaded.project.id);
        await Promise.allSettled(
          targets.map(async (target) => {
            await requestOne(options, { buildId, loaded, target });
          }),
        );
      } catch (error) {
        deps.logger.warn({ err: error, buildId }, "failed to request the build state");
      }
    },
  };
}

/** Queue the delivery; inline when there is no queue, or when queueing itself failed. */
async function requestOne(
  options: BuildStatePublisherOptions,
  request: {
    buildId: string;
    loaded: NonNullable<Awaited<ReturnType<typeof loadBuild>>>;
    target: StateTarget;
  },
): Promise<void> {
  const { enqueue, deps } = options;
  const { buildId, loaded, target } = request;
  if (enqueue !== undefined) {
    try {
      await enqueue({ channelId: target.channel.id, buildId });
      return;
    } catch (error) {
      deps.logger.warn(
        { err: error, channelId: target.channel.id, buildId },
        "failed to queue the state delivery; delivering inline",
      );
    }
  }
  await deliverInline(deps, loaded, target);
}

/** Deliver now and record the outcome on the channel; never throws. */
async function deliverInline(
  deps: BuildStateDeps,
  loaded: Parameters<typeof writeTo>[1],
  target: StateTarget,
): Promise<void> {
  const channels = new NotificationChannelModel(
    deps.db,
    { notificationChannels: deps.db.tables.notificationChannels },
    deps.secret,
  );
  let error: string | undefined;
  try {
    await writeTo(deps, loaded, target);
  } catch (writeError) {
    deps.logger.warn({ err: writeError, channelId: target.channel.id }, "state delivery failed");
    error = sanitizeErrorText(
      writeError instanceof Error ? writeError.message : String(writeError),
      500,
    );
  }
  await channels.recordOutcome(target.channel.id, error).catch((recordError: unknown) => {
    deps.logger.warn(
      { err: recordError, channelId: target.channel.id },
      "failed to record outcome",
    );
  });
}
