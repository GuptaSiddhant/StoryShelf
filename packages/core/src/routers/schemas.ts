import { z } from "@hono/zod-openapi";

import { BUILD_STATUSES, PROJECT_ROLES, SNAPSHOT_STATUSES } from "../types.ts";

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  gitRepository: z.string().nullable(),
  gitDefaultBranch: z.string(),
  pixelThreshold: z.number(),
  maxDiffRatio: z.number(),
  publicBranchRegex: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).openapi("Project");

export const projectCreateSchema = z.object({
  name: z.string().min(1),
  gitRepository: z.string().optional(),
  gitDefaultBranch: z.string().optional(),
}).openapi("ProjectCreateInput");

export const projectUpdateSchema = z.object({
  name: z.string().optional(),
  gitRepository: z.string().optional(),
  gitDefaultBranch: z.string().optional(),
  pixelThreshold: z.number().optional(),
  maxDiffRatio: z.number().optional(),
  publicBranchRegex: z.string().nullable().optional(),
}).openapi("ProjectUpdateInput");

export const buildSchema = z.object({
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
}).openapi("Build");

export const snapshotSchema = z.object({
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
}).openapi("Snapshot");

export const commentSchema = z.object({
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
}).openapi("Comment");

export const commentCreateSchema = z.object({
  body: z.string().min(1),
  snapshotId: z.string().optional(),
  parentId: z.string().optional(),
}).openapi("CommentCreateInput");

export const labelTypeSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  key: z.string(),
  name: z.string(),
  linkTemplate: z.string().nullable(),
  color: z.string().nullable(),
  createdAt: z.string(),
}).openapi("LabelType");

export const labelTypeCreateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  linkTemplate: z.string().optional(),
  color: z.string().optional(),
}).openapi("LabelTypeCreateInput");

export const tokenPublicSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
}).openapi("Token");

export const tokenCreateSchema = z.object({ name: z.string().min(1) }).openapi("TokenCreateInput");

export const tokenCreatedSchema = z.object({
  name: z.string(),
  token: z.string(),
}).openapi("TokenCreated");

export const memberSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  userId: z.string(),
  role: z.enum(PROJECT_ROLES),
  createdAt: z.string(),
}).openapi("ProjectMember");

export const memberRoleSchema = z.object({ role: z.enum(PROJECT_ROLES) }).openapi("MemberRoleInput");

export const memberSetSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(PROJECT_ROLES),
}).openapi("MemberSetInput");

export const webhookPublicSchema = z.object({
  id: z.string(),
  url: z.string(),
  events: z.array(z.string()),
}).openapi("Webhook");

export const webhookCreateSchema = z.object({
  url: z.url(),
  events: z.array(z.string().min(1)).optional(),
}).openapi("WebhookCreateInput");

export const webhookCreatedSchema = z.object({
  id: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  secret: z.string(),
}).openapi("WebhookCreated");

export const okSchema = z.object({ ok: z.boolean() }).openapi("Ok");

export const errorSchema = z.object({ message: z.string() }).openapi("Error");

export const purgeSchema = z.object({ removedBuilds: z.number() }).openapi("PurgeResult");

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