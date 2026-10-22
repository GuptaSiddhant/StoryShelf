/**
 * Domain models: constructor-injected data operations over a DatabaseAdapter.
 *
 * Routers and workers import models through this barrel
 * (`@storyshelf/core/models`); per-entity modules stay importable too.
 */
export { BaselineModel } from "./baseline.ts";
export {
  BASELINE_ARCHIVE_FORMAT,
  BASELINE_ARCHIVE_LIMITS,
  BASELINE_ARCHIVE_VERSION,
  BaselineArchiveError,
  type BaselineManifest,
  type BaselineManifestEntry,
} from "./baseline-archive.ts";
export type { BaselineExportOptions } from "./baseline-export.ts";
export { BaselineTransferModel, type BaselineImportResult } from "./baseline-transfer.ts";
export {
  baselineStatus,
  isBaselineDrifted,
  NO_BASELINE,
  type BaselineStatus,
} from "./baseline-status.ts";
export {
  CaptureAttemptModel,
  emitAttemptLog,
  type AttemptLogRecorder,
  type CaptureAttemptTables,
} from "./capture-attempt.ts";
export { CaptureLogModel, type CaptureLogTables } from "./capture-log.ts";
export {
  attemptRowId,
  CaptureJobModel,
  isTerminalJob,
  parseAttemptRowId,
  TERMINAL_JOB_STATUSES,
  type AttemptClaim,
  type CaptureJobTables,
  type NewCaptureJob,
} from "./capture-job.ts";
export { CaptureShardModel, type CaptureShardTables } from "./capture-shard.ts";
export { AiBudgetAlertModel, type AiBudgetAlertTables } from "./ai-budget-alert.ts";
export { AiUsageModel, type AiUsageInput, type AiUsageTables } from "./ai-usage.ts";
export {
  InsightModel,
  type InsightResultInput,
  type InsightStartInput,
  type InsightStartResult,
  type InsightTables,
} from "./insight.ts";
export { BuildModel, isPublicBuild, type BuildCreateInput, type BuildListFilter } from "./build.ts";
export {
  RECENT_BUILDS_FOR_INHERITED_RATIO,
  averageInheritedRatio,
  type InheritedRatio,
} from "./inherited-ratio.ts";
export { BuildReviewModel, type BuildReviewTables } from "./build-review.ts";
export {
  deriveReviewStatus,
  latestVerdicts,
  type ReviewStatusInput,
} from "./build-review-status.ts";
export {
  changesetOf,
  computeChangeset,
  findChangesetBaseline,
  type BuildChangeset,
  type Changeset,
  type ChangedComponent,
  type ChangesetComponent,
} from "./changeset.ts";
export { CommentModel, type CommentCreateInput } from "./comment.ts";
export { acceptPendingWithoutWork } from "./review-switch-off.ts";
export {
  componentHistory,
  componentPresence,
  worstStatus,
  type ComponentHistoryRow,
  type ComponentPresence,
} from "./component.ts";
export {
  BuildComponentModel,
  type BuildComponentInput,
  type BuildComponentTables,
} from "./build-component.ts";
export { ConnectionModel, type ConnectionTables } from "./connections.ts";
export { DesignModel, type DesignTables } from "./design.ts";
export {
  DesignCredentialModel,
  PROJECT_SCOPE,
  type DesignCredentialTables,
} from "./design-credentials.ts";
export { DesignNodeModel, type DesignNodeTables, type RefreshOptions } from "./design-nodes.ts";
export {
  normalizeImportPath,
  resolveDesigns,
  type DesignCredentialStatus,
  type DesignResolution,
  type DesignSource,
} from "./design-resolve.ts";
export { credentialDaysLeft, DESIGN_TTL_MS, isDesignStale } from "./design-health.ts";
export { LabelModel } from "./label.ts";
export { matchUpstreamStory, PackageUsageModel } from "./usage.ts";
export type { PackageUsageInput, PackageUsageTables, UpstreamStory } from "./usage.ts";
export { MemberModel } from "./member.ts";
export {
  NotificationChannelModel,
  type ChannelValidation,
  type NotificationChannelCreateInput,
  type NotificationChannelTables,
} from "./notification-channel.ts";
export {
  NotificationSubscriptionModel,
  type NotificationSubscriptionInput,
  type NotificationSubscriptionTables,
} from "./notification-subscription.ts";
export { ProjectModel, type ProjectCreateInput } from "./project.ts";
export { ProjectGroupMappingModel } from "./project-group-mapping.ts";
export { SnapshotModel, type SnapshotCreateInput } from "./snapshot.ts";
export { TokenModel } from "./token.ts";
export { UserModel } from "./user.ts";
export { WebhookModel, type WebhookCreateInput } from "./webhook.ts";
export { ContentRefModel } from "./content-ref.ts";
export {
  probeCredentials,
  reencryptCredentials,
  type CredentialProbe,
  type ReencryptResult,
  type UnreadableCredential,
} from "./credentials.ts";
export { SiteSettingsModel, type SiteSettingsTables } from "./site-settings.ts";
export {
  PUBLIC_ORIGIN_KEY,
  createPublicOriginResolver,
  type PublicOriginOptions,
  type PublicOriginResolver,
  type PublicOriginSource,
  type ResolvedPublicOrigin,
  type StoredPublicOrigin,
} from "./public-origin.ts";
