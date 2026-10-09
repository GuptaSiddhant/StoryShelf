/** Load triage evidence inputs (snapshots, logs, comments, thumbnails) and assemble them. */
import {
  buildTriageEvidence,
  rankSnapshots,
  resolveLimits,
  type BuiltEvidence,
  type EvidenceLimits,
  type SnapshotEvidence,
} from "@storyshelf/core/insights";
import {
  CaptureAttemptModel,
  CaptureLogModel,
  CommentModel,
  SnapshotModel,
} from "@storyshelf/core/models";
import type { Build, CaptureLog, Project, Snapshot } from "@storyshelf/core/schema";
import type { InsightDeps } from "./deps.ts";

function storyIdOf(log: CaptureLog): string | null {
  try {
    const fields = log.fields ? (JSON.parse(log.fields) as Record<string, unknown>) : {};
    return typeof fields["storyId"] === "string" ? fields["storyId"] : null;
  } catch {
    return null;
  }
}

function groupLogs(lines: CaptureLog[]): Map<string, string> {
  const grouped = new Map<string, string[]>();
  for (const line of lines.filter((l) => l.level === "warn" || l.level === "error")) {
    const id = storyIdOf(line);
    if (id) {
      grouped.set(id, [...(grouped.get(id) ?? []), `${line.level} ${line.message}`]);
    }
  }
  return new Map([...grouped].map(([id, parts]) => [id, parts.join("\n")]));
}

/** warn/error capture-log lines of the latest attempt, grouped by story. */
async function logsByStory(deps: InsightDeps, build: Build): Promise<Map<string, string>> {
  const attempts = await new CaptureAttemptModel(deps.db).listByBuild(build.id);
  const latest = attempts.toSorted((a, b) => b.attemptNo - a.attemptNo)[0];
  if (!latest) {
    return new Map();
  }
  return groupLogs(await new CaptureLogModel(deps.db).listByAttempt(latest.id, 500));
}

function logFor(logs: Map<string, string>, storyId: string): { log?: string } {
  const log = logs.get(storyId);
  return log === undefined ? {} : { log };
}

function toEvidence(snapshot: Snapshot, logs: Map<string, string>): SnapshotEvidence {
  return {
    storyId: snapshot.storyId,
    title: snapshot.storyTitle,
    name: snapshot.storyName,
    viewport: snapshot.viewportName,
    status: snapshot.status,
    diffRatio: snapshot.diffRatio,
    inherited: snapshot.inherited,
    ...logFor(logs, snapshot.storyId),
  };
}

async function attachScreenshots(
  deps: InsightDeps,
  rows: Map<string, Snapshot>,
  items: SnapshotEvidence[],
  limits: EvidenceLimits,
): Promise<SnapshotEvidence[]> {
  const top = new Set(
    items
      .filter((item) => !item.inherited)
      .toSorted(rankSnapshots)
      .slice(0, limits.maxImages)
      .map((item) => `${item.storyId}@${item.viewport}`),
  );
  return await Promise.all(
    items.map(async (item) => {
      const row = rows.get(`${item.storyId}@${item.viewport}`);
      if (!row || !top.has(`${item.storyId}@${item.viewport}`)) {
        return item;
      }
      const data = await deps.storage.read(row.screenshotPath).catch(() => null);
      return data ? { ...item, screenshot: new Uint8Array(data) } : item;
    }),
  );
}

function changedFilesOf(build: Build): string[] {
  try {
    const parsed: unknown = build.changedFiles ? JSON.parse(build.changedFiles) : [];
    return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === "string") : [];
  } catch {
    return [];
  }
}

/** Assemble triage evidence for a build from the database and storage. */
export async function loadTriageEvidence(
  deps: InsightDeps,
  project: Project,
  build: Build,
): Promise<BuiltEvidence> {
  const limits = resolveLimits(deps.ai.limits());
  const snapshots = await new SnapshotModel(deps.db).listByBuild(build.id);
  const logs = await logsByStory(deps, build);
  const rows = new Map(snapshots.map((s) => [`${s.storyId}@${s.viewportName}`, s]));
  const items = await attachScreenshots(
    deps,
    rows,
    snapshots.map((s) => toEvidence(s, logs)),
    limits,
  );
  const comments = await new CommentModel(deps.db).listByBuild(build.id);
  return buildTriageEvidence({
    projectName: project.name,
    build: {
      gitBranch: build.gitBranch,
      gitSha: build.gitSha,
      message: build.message,
      status: build.status,
      snapshotCount: build.snapshotCount,
      changedCount: build.changedCount,
      approvedCount: build.approvedCount,
      rejectedCount: build.rejectedCount,
      changedFiles: changedFilesOf(build),
    },
    snapshots: items,
    comments: comments.map((c) => ({ author: "reviewer", body: c.body })),
    limits,
  });
}
