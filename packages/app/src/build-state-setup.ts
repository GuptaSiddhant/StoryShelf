/**
 * Build-state wiring (ADR 0014, decisions 5 and 7): the publisher every build transition calls and
 * the `notify` job kind behind it. On a host that polls the queue, a transition queues one durable
 * `notify` job per git channel and the handler delivers with retries; a host with no consumer
 * (serverless) delivers inline, without durability. The consumer is built in `jobs-setup.ts`.
 */
import {
  createBuildStatePublisher,
  createNotifyEnqueuer,
  createNotifyHandler,
  notifyExhausted,
  type BuildStateDeps,
  type BuildStatePublisher,
  type KindHandler,
  type NotifyFailure,
} from "@storyshelf/core/capture";
import type { ShelfOptions } from "@storyshelf/core/config";
import { ProjectModel } from "@storyshelf/core/models";
import { buildStateFlags } from "./build-state-flags.ts";
import { credentialKeys } from "./credential-keys.ts";
import type { JobQueue } from "./job-queue.ts";
import { notifySystemWith } from "./notify.ts";
import type { ServerRuntime } from "./runtime.ts";

/** What requests and the consumer use of build-state delivery. */
export interface BuildStateWiring {
  /** Asks for a build's current state to be shown on its git channels. */
  publisher: BuildStatePublisher;
  /** Runs `notify` jobs; null when this host polls none (it delivers inline). */
  handler: KindHandler | null;
}

/** Wire build-state delivery for `options`; `jobs` is the `notify` queue, null on a host with no consumer. */
export function setupBuildState(
  options: ShelfOptions,
  runtime: ServerRuntime,
  jobs: JobQueue | null,
): BuildStateWiring {
  const deps: BuildStateDeps = {
    db: options.database,
    storage: options.storage,
    notifiers: runtime.notifiers,
    secret: credentialKeys(runtime.config),
    config: runtime.config,
    publicOrigin: async () => await runtime.publicOrigin.url(),
    flags: (project) => buildStateFlags(options.testing !== undefined, project),
    logger: runtime.logger.child({ component: "build-state" }),
  };
  if (jobs === null) {
    return { publisher: createBuildStatePublisher({ deps }), handler: null };
  }
  const handlerOptions = {
    deps,
    onFailed: async (failure: NotifyFailure): Promise<void> => {
      await alertAdmins(options, runtime, failure);
    },
  };
  jobs.exhausted.notify = notifyExhausted(handlerOptions);
  return {
    publisher: createBuildStatePublisher({
      deps,
      enqueue: createNotifyEnqueuer(deps, {
        enqueueJob: async (job) => await jobs.get().enqueueJob(job),
      }),
    }),
    handler: createNotifyHandler(handlerOptions),
  };
}

/**
 * Raise `sys:notify-failed` to the site-wide channels. Git channels are project-scoped and
 * site-wide channels deliver messages, which are not retried through `notify` jobs, so a failing
 * alert can never raise another one.
 */
async function alertAdmins(
  options: ShelfOptions,
  runtime: ServerRuntime,
  failure: NotifyFailure,
): Promise<void> {
  const project =
    failure.projectId === null
      ? null
      : await new ProjectModel(options.database).get(failure.projectId);
  await notifySystemWith(
    {
      db: options.database,
      config: runtime.config,
      ui: runtime.ui,
      logger: runtime.logger,
      notifiers: runtime.notifiers,
      notificationsConfig: options.notifications?.config,
    },
    "sys:notify-failed",
    {
      channelId: failure.channelId,
      provider: failure.provider,
      projectId: failure.projectId,
      projectSlug: project?.slug,
      buildId: failure.buildId,
      error: failure.error,
      // The formatter prints `message` in an admin alert.
      message: `${failure.provider} channel of ${project?.slug ?? "a project"} could not show build ${failure.buildId}: ${failure.error}`,
    },
  );
}
