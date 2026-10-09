/** Load project-health evidence: build aggregates plus the most churny stories. */
import {
  buildHealthEvidence,
  snapshotKey,
  type BuiltEvidence,
  type BuildSummary,
  resolveLimits,
} from "@storyshelf/core/insights";
import { BuildModel, SnapshotModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import type { InsightDeps } from "./deps.ts";

const DAY_MS = 86_400_000;

/** Parse windows like `30d` (1–365 days); null for anything else. */
export function parseWindow(window: string): number | null {
  const match = /^(?<days>\d{1,3})d$/u.exec(window);
  const days = match?.groups ? Number(match.groups["days"]) : 0;
  return days >= 1 && days <= 365 ? days : null;
}

function summarize(build: Build): BuildSummary {
  return {
    createdAt: build.createdAt,
    gitBranch: build.gitBranch,
    status: build.status,
    snapshotCount: build.snapshotCount,
    changedCount: build.changedCount,
    approvedCount: build.approvedCount,
    rejectedCount: build.rejectedCount,
  };
}

async function churnOf(
  deps: InsightDeps,
  builds: Build[],
): Promise<{ key: string; changedBuilds: number }[]> {
  const counts = new Map<string, number>();
  const model = new SnapshotModel(deps.db);
  const lists = await Promise.all(
    builds.slice(0, 20).map(async (b) => await model.listByBuild(b.id)),
  );
  for (const snapshot of lists.flat().filter((s) => !s.inherited && s.status !== "approved")) {
    const key = snapshotKey({
      title: snapshot.storyTitle,
      name: snapshot.storyName,
      viewport: snapshot.viewportName,
    });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([key, changedBuilds]) => ({ key, changedBuilds }))
    .toSorted((a, b) => b.changedBuilds - a.changedBuilds || a.key.localeCompare(b.key));
}

/** Assemble health evidence for a project window (e.g. `30d`). */
export async function loadHealthEvidence(
  deps: InsightDeps,
  project: Project,
  window: string,
  days: number,
): Promise<BuiltEvidence> {
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const all = await new BuildModel(deps.db).list(project.id);
  const builds = all.filter((b) => b.createdAt >= since);
  return buildHealthEvidence({
    projectName: project.name,
    window,
    builds: builds.map((build) => summarize(build)),
    churnyStories: await churnOf(deps, builds),
    limits: resolveLimits(deps.ai.limits()),
  });
}
