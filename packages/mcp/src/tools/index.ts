import { buildTools } from "./builds.ts";
import { commentTools } from "./comments.ts";
import { insightTools } from "./insights.ts";
import { projectTools } from "./projects.ts";
import { snapshotTools } from "./snapshots.ts";
import type { ToolDef } from "./types.ts";

/**
 * Every tool exposed in v1: read-only review data plus comments. No approvals and no build
 * verdicts: an agent must not be able to sign off a build (ADR 0013, decision 10).
 */
export const ALL_TOOLS: readonly ToolDef[] = [
  ...projectTools,
  ...buildTools,
  ...snapshotTools,
  ...insightTools,
  ...commentTools,
];
