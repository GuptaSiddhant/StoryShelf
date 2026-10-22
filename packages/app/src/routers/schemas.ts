import { z } from "@hono/zod-openapi";
import { BROWSER_NAMES, TARGET_NAME_PATTERN } from "@storyshelf/core/adapter/capture-runner";
import { WebhookModel } from "@storyshelf/core/models";
import {
  BUILD_STATUSES,
  PROJECT_ROLES,
  REVIEW_VERDICTS,
  SNAPSHOT_STATUSES,
} from "@storyshelf/core/types";
import { storybookUrlTtlOverrideError } from "@storyshelf/core/utils";

/** A capture target: an engine (`chromium`) or a remote one, `<engine>@<name>` (ADR 0007). */
const captureTargetSchema = z
  .string()
  .regex(
    new RegExp(
      `^(?:${BROWSER_NAMES.join("|")})(?:@${TARGET_NAME_PATTERN.source.slice(1, -1)})?$`,
      "u",
    ),
    "Expected an engine (chromium, firefox, webkit, chrome) or <engine>@<name>",
  );

const reviewApprovalsSchema = z.number().int().min(1).max(20);

/** Seconds a signed Storybook URL stays valid (ADR 0007, decision 5). */
const storybookUrlTtlSchema = z
  .number()
  .int()
  .superRefine((seconds, ctx) => {
    const message = storybookUrlTtlOverrideError(seconds);
    if (message !== undefined) {
      ctx.addIssue({ code: "custom", message });
    }
  });

const storybookMetaSchema = z.record(z.string(), z.unknown()).nullable().optional();

/** OpenAPI schema for a project record. */
export const projectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    gitRepository: z.string().nullable(),
    gitDefaultBranch: z.string(),
    pixelThreshold: z.number(),
    maxDiffRatio: z.number(),
    publicBranchRegex: z.string().nullable(),
    storybookMeta: z.string().nullable().optional(),
    executePlay: z.boolean(),
    playTimeoutMs: z.number(),
    /** Axe accessibility checks run during capture (default on; results never block a build). */
    runA11y: z.boolean().optional(),
    /** Storybook 10 `.test()` entries run as interaction tests during capture (default off). */
    runTests: z.boolean().optional(),
    // Stored rows predate enum validation, so the response stays a plain string.
    browser: z.string().optional(),
    /** JSON array of capture targets, primary first, primary first; null = just `browser`. */
    browsers: z.string().nullable().optional(),
    /** JSON array of mode names to capture; null = every declared mode. */
    modesAllowlist: z.string().nullable().optional(),
    /** AI profile gate: null/absent = AI off for this project. */
    aiProfile: z.string().nullable().optional(),
    /** Review is on for this project (ADR 0013, decision 1). */
    reviewEnabled: z.boolean().optional(),
    /** Approvals a build needs when `testing` is off. */
    reviewApprovals: z.number().optional(),
    /** Seconds the signed Storybook URLs of a render stay valid; null derives it from the stories. */
    storybookUrlTtlSeconds: z.number().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Project");

/** OpenAPI schema for creating a project. */
export const projectCreateSchema = z
  .object({
    name: z.string().min(1),
    gitRepository: z.string().optional(),
    gitDefaultBranch: z.string().optional(),
    storybookMeta: storybookMetaSchema,
    executePlay: z.boolean().optional(),
    playTimeoutMs: z.number().int().min(1000).max(30_000).optional(),
    /** Axe accessibility checks during capture; on when omitted. */
    runA11y: z.boolean().optional(),
    /** Run Storybook 10 `.test()` entries as interaction tests during capture; off when omitted. */
    runTests: z.boolean().optional(),
    reviewEnabled: z.boolean().optional(),
    reviewApprovals: reviewApprovalsSchema.optional(),
  })
  .openapi("ProjectCreateInput");

/** OpenAPI schema for patching a project. */
export const projectUpdateSchema = z
  .object({
    name: z.string().optional(),
    gitRepository: z.string().optional(),
    gitDefaultBranch: z.string().optional(),
    pixelThreshold: z.number().optional(),
    maxDiffRatio: z.number().optional(),
    publicBranchRegex: z.string().nullable().optional(),
    storybookMeta: storybookMetaSchema,
    executePlay: z.boolean().optional(),
    playTimeoutMs: z.number().int().min(1000).max(30_000).optional(),
    /** Turn axe accessibility checks during capture on or off (admins). */
    runA11y: z.boolean().optional(),
    /** Turn the Storybook 10 `.test()` runs on or off (admins). */
    runTests: z.boolean().optional(),
    /** Single capture target; clears `browsers`. */
    browser: captureTargetSchema.optional(),
    /** Capture targets, primary first (max 3); null returns to single `browser`. */
    browsers: z.array(captureTargetSchema).min(1).max(3).nullable().optional(),
    /** Mode names to capture; null runs every declared mode. */
    modesAllowlist: z.array(z.string().min(1)).max(50).nullable().optional(),
    /** Site admins only: a configured AI profile name, or null to turn AI off. */
    aiProfile: z.string().min(1).nullable().optional(),
    /** Turn review (comments and build-level verdicts) on or off for the project. */
    reviewEnabled: z.boolean().optional(),
    /** Approvals a build needs before it is accepted when `testing` is off. */
    reviewApprovals: reviewApprovalsSchema.optional(),
    /** Seconds (at least one minimum slice plus grace, 1050, to 86400) the signed Storybook URLs of a render stay valid; null derives it from the stories. */
    storybookUrlTtlSeconds: storybookUrlTtlSchema.nullable().optional(),
  })
  .openapi("ProjectUpdateInput");

/** OpenAPI schema for a build record. */
export const buildSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    gitSha: z.string(),
    gitBranch: z.string(),
    isDefault: z.boolean(),
    authorEmail: z.string().nullable(),
    authorName: z.string().nullable(),
    message: z.string().nullable(),
    public: z.boolean(),
    status: z.enum(BUILD_STATUSES),
    snapshotCount: z.number(),
    changedCount: z.number(),
    approvedCount: z.number(),
    rejectedCount: z.number(),
    inheritedCount: z.number(),
    affectedOnly: z.boolean(),
    baselineSha: z.string().nullable(),
    changedFiles: z.string().nullable(),
    affectedImportPaths: z.string().nullable(),
    /** JSON array of the build's Storybook `.test()` results (id, title, name, status, error); null when none ran. */
    testResults: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Build");

/** OpenAPI schema for a snapshot record. */
export const snapshotSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    buildId: z.string(),
    storyId: z.string(),
    storyName: z.string(),
    storyTitle: z.string(),
    storyImportPath: z.string().nullable(),
    viewportName: z.string(),
    /** Globals JSON the capture's mode applied; null for plain viewports. */
    mode: z.string().nullable().optional(),
    viewportWidth: z.number(),
    viewportHeight: z.number(),
    screenshotPath: z.string(),
    diffPath: z.string().nullable(),
    diffPixels: z.number().nullable(),
    diffRatio: z.number().nullable(),
    diffPassed: z.boolean().nullable(),
    status: z.enum(SNAPSHOT_STATUSES),
    reviewedBy: z.string().nullable(),
    reviewedAt: z.string().nullable(),
    inherited: z.boolean(),
    /** JSON array of the axe violations found on this capture (non-blocking); null when none. */
    a11yViolations: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Snapshot");

/** OpenAPI schema for a capture attempt (one run of a build's capture). */
export const attemptSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    buildId: z.string(),
    attemptNo: z.number(),
    status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    error: z.string().nullable(),
    reqId: z.string().nullable(),
    storyCount: z.number(),
    failedCount: z.number(),
    queuedAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("CaptureAttempt");

/** OpenAPI schema for a single capture log line within an attempt. */
export const attemptLogSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    buildId: z.string(),
    attemptId: z.string(),
    seq: z.number(),
    level: z.string(),
    message: z.string(),
    fields: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("CaptureLog");

/** OpenAPI schema for a build comment. */
export const commentSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    buildId: z.string(),
    snapshotId: z.string().nullable(),
    /** Storybook story id of a story-anchored comment. */
    storyId: z.string().nullable().optional(),
    userId: z.string().nullable(),
    body: z.string(),
    parentId: z.string().nullable(),
    resolved: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Comment");

/** OpenAPI schema for creating a build comment. */
export const commentCreateSchema = z
  .object({
    body: z.string().min(1),
    /** Anchor to a snapshot; not together with `storyId`. */
    snapshotId: z.string().optional(),
    /** Anchor to a story of the build; not together with `snapshotId`. */
    storyId: z.string().min(1).optional(),
    parentId: z.string().optional(),
  })
  .openapi("CommentCreateInput");

/** OpenAPI schema for a build-level review verdict. */
export const buildReviewSchema = z
  .object({
    id: z.string(),
    buildId: z.string(),
    userId: z.string().nullable(),
    verdict: z.enum(REVIEW_VERDICTS),
    body: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("BuildReview");

/** OpenAPI schema for giving a build a verdict. */
export const buildReviewCreateSchema = z
  .object({
    verdict: z.enum(REVIEW_VERDICTS),
    body: z.string().max(4000).optional(),
  })
  .openapi("BuildReviewInput");

/** OpenAPI schema for a build's review state: the verdicts and what they make of the build. */
export const buildReviewStateSchema = z
  .object({
    /** Build status now. */
    status: z.enum(BUILD_STATUSES),
    /** Approvals the project requires. */
    approvalsRequired: z.number(),
    /** Approvals among the reviewers' latest verdicts. */
    approvals: z.number(),
    /** Every reviewer's latest verdict. */
    latest: buildReviewSchema.array(),
    /** Every verdict given, oldest first. */
    history: buildReviewSchema.array(),
  })
  .openapi("BuildReviewState");

/** OpenAPI schema for a project label type. */
export const labelTypeSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    key: z.string(),
    name: z.string(),
    linkTemplate: z.string().nullable(),
    color: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("LabelType");

/** OpenAPI schema for creating a label type. */
export const labelTypeCreateSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    linkTemplate: z.string().optional(),
    color: z.string().optional(),
  })
  .openapi("LabelTypeCreateInput");

/** OpenAPI schema for patching a label type. */
export const labelTypeUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    linkTemplate: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
  })
  .openapi("LabelTypeUpdateInput");

/** OpenAPI schema for a public API token (hash omitted). */
export const tokenPublicSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    lastUsedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("Token");

/** OpenAPI schema for creating an API token. */
export const tokenCreateSchema = z.object({ name: z.string().min(1) }).openapi("TokenCreateInput");

/** OpenAPI schema for a newly created token including its secret value. */
export const tokenCreatedSchema = z
  .object({
    name: z.string(),
    token: z.string(),
  })
  .openapi("TokenCreated");

/** OpenAPI schema for a project member record. */
export const memberSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    userId: z.string(),
    role: z.enum(PROJECT_ROLES),
    createdAt: z.string(),
  })
  .openapi("ProjectMember");

/** OpenAPI schema for updating a member's role. */
export const memberRoleSchema = z
  .object({ role: z.enum(PROJECT_ROLES) })
  .openapi("MemberRoleInput");

/** OpenAPI schema for adding a member to a project. */
export const memberSetSchema = z
  .object({
    userId: z.string().min(1),
    role: z.enum(PROJECT_ROLES),
  })
  .openapi("MemberSetInput");

/** OpenAPI schema for an identity-provider group mapping. */
export const groupMappingSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    groupName: z.string(),
    role: z.enum(PROJECT_ROLES),
    createdAt: z.string(),
  })
  .openapi("GroupMapping");

/** OpenAPI schema for creating a group mapping. */
export const groupMappingCreateSchema = z
  .object({
    groupName: z.string().min(1),
    role: z.enum(PROJECT_ROLES),
  })
  .openapi("GroupMappingCreateInput");

/** OpenAPI schema for a public webhook (secret omitted). */
export const webhookPublicSchema = z
  .object({
    id: z.string(),
    url: z.string(),
    events: z.array(z.string()),
  })
  .openapi("Webhook");

// oxlint-disable-next-line typescript/no-deprecated -- z.string().url() kept for zod v3 API compat
const webhookUrlBase = z.string().url();

/** OpenAPI schema for creating a webhook. */
export const webhookCreateSchema = z
  .object({
    url: webhookUrlBase.refine((url) => WebhookModel.urlError(url) === null, {
      message: "URL must use http or https",
    }),
    events: z.array(z.string().min(1)).optional(),
  })
  .openapi("WebhookCreateInput");

/** OpenAPI schema for a newly created webhook including its signing secret. */
export const webhookCreatedSchema = z
  .object({
    id: z.string(),
    url: z.string(),
    events: z.array(z.string()),
    secret: z.string(),
  })
  .openapi("WebhookCreated");

/** OpenAPI schema for a public notification channel (secret omitted). */
export const notificationChannelSchema = z
  .object({
    id: z.string(),
    projectId: z.string().nullable(),
    provider: z.string(),
    config: z.record(z.string(), z.unknown()),
    hasSecret: z.boolean(),
    events: z.array(z.string()),
    enabled: z.boolean(),
    lastError: z.string().nullable(),
    lastErrorAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("NotificationChannel");

/** OpenAPI schema for creating a notification channel. */
export const notificationChannelCreateSchema = z
  .object({
    provider: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
    secret: z.string().min(1).optional(),
    events: z.array(z.string().min(1)).optional(),
    enabled: z.boolean().optional(),
  })
  .openapi("NotificationChannelCreateInput");

/** OpenAPI schema for a per-user notification subscription. */
export const notificationSubscriptionSchema = z
  .object({
    projectId: z.string(),
    userId: z.string(),
    events: z.array(z.string()),
    via: z.array(z.string()),
    enabled: z.boolean(),
  })
  .openapi("NotificationSubscription");

/** OpenAPI schema for setting your own notification subscription. */
export const notificationSubscriptionPutSchema = z
  .object({
    events: z.array(z.string().min(1)).optional(),
    via: z.array(z.string().min(1)).optional(),
    enabled: z.boolean().optional(),
  })
  .openapi("NotificationSubscriptionPutInput");

/** OpenAPI schema for a generic `{ ok: true }` acknowledgement. */
export const okSchema = z.object({ ok: z.boolean() }).openapi("Ok");

/** Bulk approve result: ids skipped because their baseline changed after the diff. */
export const approveAllResultSchema = z
  .object({ ok: z.boolean(), skipped: z.array(z.string()) })
  .openapi("ApproveAllResult");

/** Group decision result: the snapshots one story/mode decision covered. */
export const groupDecisionResultSchema = z
  .object({ ok: z.boolean(), snapshotIds: z.array(z.string()) })
  .openapi("GroupDecisionResult");

/** Result of re-diffing a build against the baselines that apply now. */
export const rediffResultSchema = z
  .object({
    ok: z.boolean(),
    rediffed: z.number().int(),
    statusChanged: z.number().int(),
    missingScreenshots: z.array(z.string()),
  })
  .openapi("RediffResult");

/** 409 returned when approving a snapshot whose baseline changed after the diff. */
export const baselineChangedSchema = z
  .object({
    code: z.literal("baseline_changed"),
    message: z.string(),
    snapshotId: z.string(),
    baselineStatus: z.enum(["stale", "removed"]),
  })
  .openapi("BaselineChanged");

/** OpenAPI schema for an error response message. */
export const errorSchema = z.object({ message: z.string() }).openapi("Error");

/** OpenAPI schema for the retention purge result. */
export const purgeSchema = z
  .object({
    removedBuilds: z.number(),
    removedBranches: z.number().optional(),
    removedBaselines: z.number().optional(),
  })
  .openapi("PurgeResult");

/** OpenAPI schema for the retention purge input. */
export const purgeInputSchema = z.object({ ttlDays: z.number().optional() }).openapi("PurgeInput");

/** Shared response spec for a 400 Bad Request. */
export const badRequest = {
  400: { content: { "application/json": { schema: errorSchema } }, description: "Bad request" },
} as const;

/** Shared response spec for a 401 Unauthorized. */
export const unauthorized = {
  401: { content: { "application/json": { schema: errorSchema } }, description: "Unauthorized" },
} as const;

/** Shared response spec for a 403 Forbidden. */
export const forbidden = {
  403: { content: { "application/json": { schema: errorSchema } }, description: "Forbidden" },
} as const;

/** Shared response spec for a 404 Not Found. */
export const notFound = {
  404: { content: { "application/json": { schema: errorSchema } }, description: "Not found" },
} as const;

/** OpenAPI schema for an insight (build triage or project health). */
export const insightSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["triage", "health"]),
    buildId: z.string().nullable(),
    window: z.string().nullable(),
    status: z.enum(["pending", "running", "done", "failed"]),
    profile: z.string(),
    model: z.string(),
    promptVersion: z.string(),
    verdict: z.string().nullable(),
    summary: z.string().nullable(),
    output: z.unknown().nullable(),
    meta: z.unknown().nullable(),
    errorCode: z.string().nullable(),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
  })
  .openapi("Insight");

/** Request body to (re)generate a build triage. */
export const insightRequestSchema = z
  .object({
    task: z.literal("triage").optional(),
    force: z.boolean().optional(),
    profile: z.string().min(1).optional(),
  })
  .openapi("InsightRequest");

/** Request body to (re)generate a project-health digest. */
export const healthRequestSchema = z
  .object({ window: z.string().optional(), force: z.boolean().optional() })
  .openapi("HealthInsightRequest");
