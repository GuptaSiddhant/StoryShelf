import { z } from "@hono/zod-openapi";
import { BUILD_STATUSES, PROJECT_ROLES, SNAPSHOT_STATUSES } from "../types.ts";

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
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Snapshot");

/** OpenAPI schema for a build comment. */
export const commentSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    buildId: z.string(),
    snapshotId: z.string().nullable(),
    userId: z.string(),
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
    snapshotId: z.string().optional(),
    parentId: z.string().optional(),
  })
  .openapi("CommentCreateInput");

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

/** OpenAPI schema for a public webhook (secret omitted). */
export const webhookPublicSchema = z
  .object({
    id: z.string(),
    url: z.string(),
    events: z.array(z.string()),
  })
  .openapi("Webhook");

/** OpenAPI schema for creating a webhook. */
export const webhookCreateSchema = z
  .object({
    // oxlint-disable-next-line typescript/no-deprecated -- z.string().url() kept for zod v3 API compat
    url: z.string().url(),
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

/** OpenAPI schema for a git status-check configuration. */
export const statusConfigSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    provider: z.string(),
    config: z.record(z.string(), z.unknown()),
    hasToken: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("StatusConfig");

/** OpenAPI schema for creating a git status-check configuration. */
export const statusConfigCreateSchema = z
  .object({
    provider: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
    token: z.string().min(1),
  })
  .openapi("StatusConfigCreateInput");

/** OpenAPI schema for a generic `{ ok: true }` acknowledgement. */
export const okSchema = z.object({ ok: z.boolean() }).openapi("Ok");

/** OpenAPI schema for an error response message. */
export const errorSchema = z.object({ message: z.string() }).openapi("Error");

/** OpenAPI schema for the retention purge result. */
export const purgeSchema = z.object({ removedBuilds: z.number() }).openapi("PurgeResult");

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
