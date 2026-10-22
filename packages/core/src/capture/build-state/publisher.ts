/**
 * The one entry point for "this build changed, show it" (ADR 0014, decisions 5 and 7). Every build
 * transition and the end of publishing call `request`; it hands each git channel of the project a
 * durable `notify` job, or, on a host with no queue consumer, delivers inline. While no public
 * origin is resolved it does neither (ADR 0014, decision 11): every link would be empty.
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

/** Logged once when the first request finds no public origin, and again after one came back and went. */
export const PAUSED_MESSAGE =
  "notifications are paused until a public URL is set (PUBLIC_BASE_URL or a confirmed detected origin)";

/** A publisher over `options.deps`. */
export function createBuildStatePublisher(
  options: BuildStatePublisherOptions,
): BuildStatePublisher {
  const { deps } = options;
  const pause = { logged: false };
  return {
    request: async (buildId) => {
      try {
        const origin = await deps.publicOrigin();
        if (!origin) {
          logPaused(deps, pause, buildId);
          return;
        }
        pause.logged = false;
        await requestAll(options, { buildId, origin });
      } catch (error) {
        deps.logger.warn({ err: error, buildId }, "failed to request the build state");
      }
    },
  };
}

/** Warn on the first request of a pause only. */
function logPaused(deps: BuildStateDeps, pause: { logged: boolean }, buildId: string): void {
  if (!pause.logged) {
    deps.logger.warn({ buildId }, PAUSED_MESSAGE);
  }
  pause.logged = true;
}

/** Ask every state channel of the build's project to show it. */
async function requestAll(
  options: BuildStatePublisherOptions,
  where: { buildId: string; origin: string },
): Promise<void> {
  const { deps } = options;
  const { buildId, origin } = where;
  const loaded = await loadBuild(deps, buildId);
  if (loaded === null) {
    return;
  }
  const targets = await stateTargets(deps, loaded.project.id);
  await Promise.allSettled(
    targets.map(async (target) => {
      await requestOne(options, { buildId, loaded, target, origin });
    }),
  );
}

/** Queue the delivery; inline when there is no queue, or when queueing itself failed. */
async function requestOne(
  options: BuildStatePublisherOptions,
  request: {
    buildId: string;
    loaded: NonNullable<Awaited<ReturnType<typeof loadBuild>>>;
    target: StateTarget;
    origin: string;
  },
): Promise<void> {
  const { enqueue, deps } = options;
  const { buildId, loaded, target, origin } = request;
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
  await deliverInline(deps, loaded, { target, origin });
}

/** Deliver now and record the outcome on the channel; never throws. */
async function deliverInline(
  deps: BuildStateDeps,
  loaded: Parameters<typeof writeTo>[1],
  where: Parameters<typeof writeTo>[2],
): Promise<void> {
  const { target } = where;
  const channels = new NotificationChannelModel(
    deps.db,
    { notificationChannels: deps.db.tables.notificationChannels },
    deps.secret,
  );
  let error: string | undefined;
  try {
    await writeTo(deps, loaded, where);
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
