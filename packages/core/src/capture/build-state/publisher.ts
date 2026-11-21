/**
 * The one entry point for "this build changed, show it" (ADR 0014, decisions 5 and 7). Every build
 * transition and the end of publishing call `request`; it hands each git channel and approved
 * repository link (ADR 0054) of the project a durable `notify` job, or, on a host with no queue
 * consumer, delivers inline. While no public
 * origin is resolved it does neither (ADR 0014, decision 11): every link would be empty.
 */
import { NotificationChannelModel } from "../../models/notification-channel.ts";
import { sanitizeErrorText } from "../../utils/redact.ts";
import { channelTargets, loadBuild, writeTo } from "./deliver.ts";
import { approvedLinks, deliverToLink } from "./link-target.ts";
import type { NotifyRequest } from "./notify-job.ts";
import type { BuildStateDeps, BuildStatePublisher, StateTarget } from "./types.ts";

/** What {@link createBuildStatePublisher} needs. */
export interface BuildStatePublisherOptions {
  deps: BuildStateDeps;
  /**
   * Queues a `notify` job. Set when this instance (or another one) consumes the queue; absent, the
   * state is delivered inline in the caller's request, without durability.
   */
  enqueue?: ((job: NotifyRequest) => Promise<void>) | undefined;
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
    request: async (buildId, only) => {
      try {
        const origin = await deps.publicOrigin();
        if (!origin) {
          logPaused(deps, pause, buildId);
          return;
        }
        pause.logged = false;
        await requestAll(options, { buildId, origin, ...only });
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

type Loaded = NonNullable<Awaited<ReturnType<typeof loadBuild>>>;

/** What one request covers: a build, and optionally a single channel or link of its project. */
interface RequestScope {
  buildId: string;
  origin: string;
  channelId?: string | undefined;
  linkId?: string | undefined;
}

/** Ask every git channel and approved link of the build's project (or the one named) to show it. */
async function requestAll(options: BuildStatePublisherOptions, scope: RequestScope): Promise<void> {
  const { deps } = options;
  const loaded = await loadBuild(deps, scope.buildId);
  if (loaded === null) {
    return;
  }
  const projectId = loaded.project.id;
  const channels =
    scope.linkId === undefined
      ? (await channelTargets(deps, projectId)).filter(
          (target) => scope.channelId === undefined || target.channel.id === scope.channelId,
        )
      : [];
  const links =
    scope.channelId === undefined
      ? (await approvedLinks(deps, projectId)).filter(
          (link) => scope.linkId === undefined || link.id === scope.linkId,
        )
      : [];
  await Promise.allSettled([
    ...channels.map(async (target) => {
      await requestChannel(options, { ...scope, loaded, target });
    }),
    ...links.map(async (link) => {
      await requestLink(options, { ...scope, loaded, linkId: link.id });
    }),
  ]);
}

/** Queue the job; false when there is no queue or queueing failed (the caller delivers inline). */
async function queued(options: BuildStatePublisherOptions, job: NotifyRequest): Promise<boolean> {
  if (options.enqueue === undefined) {
    return false;
  }
  try {
    await options.enqueue(job);
    return true;
  } catch (error) {
    options.deps.logger.warn(
      { err: error, ...job },
      "failed to queue the state delivery; delivering inline",
    );
    return false;
  }
}

/** Queue the channel's delivery; inline when there is no queue, or when queueing itself failed. */
async function requestChannel(
  options: BuildStatePublisherOptions,
  request: { buildId: string; loaded: Loaded; target: StateTarget; origin: string },
): Promise<void> {
  const { buildId, loaded, target, origin } = request;
  if (!(await queued(options, { channelId: target.channel.id, buildId }))) {
    await deliverInline(options.deps, loaded, { target, origin });
  }
}

/** Queue the link's delivery; inline (with the same refusal rule as the job) when not queued. */
async function requestLink(
  options: BuildStatePublisherOptions,
  request: { buildId: string; loaded: Loaded; linkId: string; origin: string },
): Promise<void> {
  const { deps } = options;
  const { buildId, loaded, linkId, origin } = request;
  if (await queued(options, { linkId, buildId })) {
    return;
  }
  try {
    await deliverToLink(deps, loaded, {
      linkId,
      write: async (target) => {
        await writeTo(deps, loaded, { target, origin });
      },
    });
  } catch (error) {
    deps.logger.warn({ err: error, linkId }, "state delivery failed");
  }
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
