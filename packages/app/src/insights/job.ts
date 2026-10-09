/** Background insight job: summarize, record usage, persist the result, notify. */
import { AiError, type AiEvidence, type AiSummarizeResult, type AiTask } from "@storyshelf/core/ai";
import { InsightModel } from "@storyshelf/core/models";
import type { InsightRow, Project } from "@storyshelf/core/schema";
import type { z } from "zod";
import { notifyProjectWith } from "../notify.ts";
import { recordUsage } from "./budget.ts";
import type { InsightDeps } from "./deps.ts";

const running = new Set<Promise<void>>();

/** Wait for in-flight jobs (graceful teardown and tests). */
export async function settleInsightJobs(): Promise<void> {
  await Promise.allSettled(running);
}

/** What a job summarizes. */
export interface JobSpec<T extends { verdict: string; summary: string }> {
  task: AiTask;
  system: string;
  evidence: AiEvidence;
  schema: z.ZodType<T>;
  profileRequested: string | null;
  project: Pick<Project, "id" | "slug">;
  /** Review-page suffix for the `insight:ready` link. */
  reviewSuffix: string;
}

/** Result envelope stored in `insights.result` (output plus fallback markers). */
export function packResult<T>(
  result: AiSummarizeResult<T>,
  profileRequested: string | null,
): string {
  return JSON.stringify({
    output: result.object,
    meta: {
      profileRequested,
      profileEffective: result.profileEffective,
      visionSkipped: result.visionSkipped,
      imagesSent: result.imagesSent,
      warnings: result.warnings,
      usage: result.usage,
    },
  });
}

async function succeed<T extends { verdict: string; summary: string }>(
  deps: InsightDeps,
  row: InsightRow,
  spec: JobSpec<T>,
  result: AiSummarizeResult<T>,
): Promise<void> {
  await recordUsage(deps, {
    insightId: row.id,
    projectId: row.projectId,
    profile: result.profileEffective,
    task: spec.task,
    model: result.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimated: result.usage.estimated,
    images: result.imagesSent,
    status: "ok",
  });
  await new InsightModel(deps.db).markDone(row.id, {
    verdict: result.object.verdict,
    summary: result.object.summary,
    result: packResult(result, spec.profileRequested),
  });
  await notifyProjectWith(
    deps.notify,
    spec.project,
    "insight:ready",
    {
      insightId: row.id,
      kind: row.kind,
      verdict: result.object.verdict,
      summary: result.object.summary.slice(0, 300),
    },
    spec.reviewSuffix,
  );
}

async function fail(
  deps: InsightDeps,
  row: InsightRow,
  spec: { task: AiTask; evidence: AiEvidence },
  error: unknown,
): Promise<void> {
  const failure = error instanceof AiError ? error : new AiError("unknown", "insight job failed");
  deps.logger.warn({ insightId: row.id, code: failure.code }, "insight job failed");
  if (failure.usage) {
    await recordUsage(deps, {
      insightId: row.id,
      projectId: row.projectId,
      profile: row.profile,
      task: spec.task,
      model: row.model,
      inputTokens: failure.usage.inputTokens,
      outputTokens: failure.usage.outputTokens,
      estimated: failure.usage.estimated,
      images: spec.evidence.images.length,
      status: "failed",
    });
  }
  await new InsightModel(deps.db).markFailed(row.id, failure.code);
}

async function execute<T extends { verdict: string; summary: string }>(
  deps: InsightDeps,
  row: InsightRow,
  spec: JobSpec<T>,
): Promise<void> {
  try {
    await new InsightModel(deps.db).markRunning(row.id);
    const result = await deps.ai.summarize({
      task: spec.task,
      profile: row.profile,
      system: spec.system,
      evidence: spec.evidence,
      schema: spec.schema,
    });
    await succeed(deps, row, spec, result);
  } catch (error) {
    await fail(deps, row, spec, error).catch((inner: unknown) => {
      deps.logger.error({ err: inner, insightId: row.id }, "insight failure bookkeeping failed");
    });
  }
}

/** Start a job without awaiting it (tracked for graceful settle). */
export function spawnJob<T extends { verdict: string; summary: string }>(
  deps: InsightDeps,
  row: InsightRow,
  spec: JobSpec<T>,
): void {
  const promise = execute(deps, row, spec).finally(() => {
    running.delete(promise);
  });
  running.add(promise);
}
