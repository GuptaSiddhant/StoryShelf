/**
 * Build state on git channels (ADR 0014, decisions 5 to 7): the delivery that reads a build and
 * shows it, the publisher every transition calls, and the durable `notify` job kind behind it.
 */
export {
  moveGitChannel,
  type ChannelMove,
  type ChannelMoveDeps,
  type ChannelMoveRequest,
  type ChannelMoveTarget,
} from "./channel-move.ts";
export { channelTargets, deliverBuildState, loadBuild, stateTargets, writeTo } from "./deliver.ts";
export {
  approveRepositoryLink,
  requestRepositoryLink,
  type LinkApproval,
  type LinkApprovalDeps,
} from "./link-approval.ts";
export { linkChannel, postsComments } from "./link-channel.ts";
export { approvedLinks, deliverToLink, linkTarget, linkTargets } from "./link-target.ts";
export {
  createNotifyEnqueuer,
  createNotifyHandler,
  NOTIFY_BACKOFF,
  NOTIFY_LINK_PAYLOAD_VERSION,
  NOTIFY_MAX_ATTEMPTS,
  notifyExhausted,
  type NotifyRequest,
  type NotifyFailure,
  type NotifyHandlerOptions,
  type NotifyJobQueue,
} from "./notify-job.ts";
export {
  createBuildStatePublisher,
  PAUSED_MESSAGE,
  type BuildStatePublisherOptions,
} from "./publisher.ts";
export {
  requestOpenBuildStates,
  tryRequestOpenBuildStates,
  type OpenBuildRequest,
  type OpenBuildScope,
} from "./resume.ts";
export type {
  BuildStateDeps,
  BuildStatePublisher,
  SkipReason,
  StateTarget,
  TargetRef,
} from "./types.ts";
