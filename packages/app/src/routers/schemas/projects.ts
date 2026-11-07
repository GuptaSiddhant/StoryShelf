/** Project schemas, and the field helpers only they use. */
import { z } from "@hono/zod-openapi";
import { BROWSER_NAMES, TARGET_NAME_PATTERN } from "@storyshelf/core/adapter/capture-runner";
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
    /** Changed snapshots are rendered once more and flagged when the renders differ (default on). */
    detectUnstable: z.boolean().optional(),
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
    /** Re-render changed snapshots once and flag unstable ones; on when omitted. */
    detectUnstable: z.boolean().optional(),
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
    /** Turn unstable-render detection on or off (admins). */
    detectUnstable: z.boolean().optional(),
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
