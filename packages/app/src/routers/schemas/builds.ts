/** Build, snapshot and capture-attempt schemas, and the results of deciding on a build. */
import { z } from "@hono/zod-openapi";
import { BUILD_STATUSES, SNAPSHOT_STATUSES } from "@storyshelf/core/types";

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
    /** For a `skipped` build, the real build whose outcome it repeats (ADR 0044). */
    skippedFromBuildId: z.string().nullable().optional(),
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
    /** A second render of this changed snapshot differed from the first (likely flaky); null: not checked. */
    unstable: z.boolean().nullable().optional(),
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
    error: z.object({
      code: z.literal("baseline_changed"),
      message: z.string(),
      snapshotId: z.string(),
      baselineStatus: z.enum(["stale", "removed"]),
    }),
  })
  .openapi("BaselineChanged");
