/** Data for the project health panel and card badge (null when AI is off for the project). */
import { InsightModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import { APPROVER_ROLES } from "../routers/builds.handlers.ts";
import { currentProjectRole } from "../routers/helpers.ts";
import { getStore } from "../store.ts";
import { insightDepsFromStore } from "./deps.ts";
import { freshen } from "./stale.ts";
import { toInsightView, type InsightView } from "./view.ts";

/** The window the UI shows and generates. */
export const HEALTH_UI_WINDOW = "30d";

/** What the health panel shows. */
export interface HealthPanelData {
  latest: InsightView | null;
  canGenerate: boolean;
}

/** Compact health for the project card. */
export interface HealthBadge {
  verdict: string;
  score: number | null;
}

/** Load the panel, or null when AI is off site-wide or for the project. */
export async function loadHealthPanel(project: Project): Promise<HealthPanelData | null> {
  const deps = insightDepsFromStore();
  if (!deps || project.aiProfile === null || project.aiProfile === undefined) {
    return null;
  }
  const row = await new InsightModel(deps.db).getHealth(project.id, HEALTH_UI_WINDOW);
  const role = getStore().authEnabled ? await currentProjectRole(project.id) : "admin";
  return {
    latest: row ? toInsightView(await freshen(deps, row)) : null,
    canGenerate: role !== null && (APPROVER_ROLES as readonly string[]).includes(role),
  };
}

function scoreOf(output: unknown): number | null {
  const score = (output as { score?: unknown } | null)?.score;
  return typeof score === "number" ? score : null;
}

/** The finished digest as a card badge, or null when none is available. */
export async function loadHealthBadge(project: Project): Promise<HealthBadge | null> {
  const { ai, db } = getStore();
  if (!ai || project.aiProfile === null || project.aiProfile === undefined) {
    return null;
  }
  const row = await new InsightModel(db).getHealth(project.id, HEALTH_UI_WINDOW);
  if (row?.status !== "done" || row.verdict === null) {
    return null;
  }
  return { verdict: row.verdict, score: scoreOf(toInsightView(row).output) };
}
