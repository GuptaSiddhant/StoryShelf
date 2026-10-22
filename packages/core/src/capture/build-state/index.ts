/**
 * Build state on git channels (ADR 0014, decisions 5 to 7): the delivery that reads a build and
 * shows it, the publisher every transition calls, and the durable `notify` job kind behind it.
 */
export { deliverBuildState, loadBuild, stateTargets, writeTo } from "./deliver.ts";
export {
  createNotifyEnqueuer,
  createNotifyHandler,
  NOTIFY_BACKOFF,
  NOTIFY_MAX_ATTEMPTS,
  notifyExhausted,
  type NotifyFailure,
  type NotifyHandlerOptions,
  type NotifyJobQueue,
} from "./notify-job.ts";
export { createBuildStatePublisher, type BuildStatePublisherOptions } from "./publisher.ts";
export type { BuildStateDeps, BuildStatePublisher, SkipReason, StateTarget } from "./types.ts";
