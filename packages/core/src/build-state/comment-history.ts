/** What the comment says about stories gone since the baseline and the builds before this one (ADR 0014). */
import type { BuildStateExtras } from "../adapters/notifier/build-state.ts";
import { readCatalog } from "../catalog/catalogue.ts";
import type { CatalogEntry } from "../catalog/types.ts";
import { BuildModel } from "../models/build.ts";
import { SnapshotModel } from "../models/snapshot.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import type { BuildStatus } from "../types.ts";
import type { UrlBuilder } from "../urls.ts";
import type { BuildStateDeps } from "./types.ts";

/** Earlier builds listed in the comment, newest first. */
export const EARLIER_BUILDS_SHOWN = 10;

/** Builds read first to find those before this one; the read doubles while newer builds fill it. */
const EARLIER_BUILDS_READ = 50;

/** The build state by status: a fixed phrase, so the comment never carries stored text. */
const STATE_BY_STATUS: Readonly<Record<string, string>> = {
  approved: "✅ approved",
  rejected: "❌ rejected",
  failed: "⚠️ failed",
  cancelled: "⚪ cancelled",
  skipped: "⏭️ skipped",
  capturing: "⏳ capturing",
  comparing: "⏳ comparing",
  reviewing: "🟡 waiting for review",
  pending: "⏳ pending",
};

/** Statuses whose published index is final, so a comparison with the baseline says something. */
const COMPARABLE: ReadonlySet<BuildStatus> = new Set(["reviewing", "approved", "rejected"]);

type Where = { build: Build; project: Project };

/** `row` was created before `build` (the id breaks a tie in the same millisecond). */
function isBefore(row: Pick<Build, "id" | "createdAt">, build: Build): boolean {
  return row.createdAt === build.createdAt ? row.id < build.id : row.createdAt < build.createdAt;
}

/** The build a frozen comparison says its baseline image came from; null when the record is unusable. */
function recordedSourceOf(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  try {
    const { sourceBuildId } = JSON.parse(raw) as { sourceBuildId?: unknown };
    return typeof sourceBuildId === "string" && sourceBuildId !== "" ? sourceBuildId : null;
  } catch {
    return null;
  }
}

/**
 * The build the capture compared against: the newest of the builds that rendered the baseline
 * images frozen on this build's snapshots (`comparisonMetadata`, written once at capture). It is
 * read, never re-derived, so an older build approved later cannot change it, and the list names
 * exactly what was compared. Null while the capture recorded no baseline (a first build, a legacy
 * row) or its source build is gone.
 */
async function baselineBuildOf(deps: BuildStateDeps, where: Where): Promise<Build | null> {
  const { build, project } = where;
  const snapshots = await new SnapshotModel(deps.db).listByBuildSummary(build.id);
  const sources = new Set(
    snapshots.flatMap((row) => recordedSourceOf(row.comparisonMetadata) ?? []),
  );
  sources.delete(build.id);
  const builds = new BuildModel(deps.db);
  const found = await Promise.all([...sources].map(async (id) => await builds.get(id)));
  const rows = found.filter((row): row is Build => row !== null && row.projectId === project.id);
  const [newest] = rows.toSorted((a, b) => (isBefore(a, b) ? 1 : -1));
  return newest ?? null;
}

function storiesOf(entries: readonly CatalogEntry[]): Map<string, string> {
  return new Map(
    entries
      .filter((entry) => entry.type === "story")
      .map((entry) => [entry.id, `${entry.title} / ${entry.name}`] as const),
  );
}

/** A stored entry is a story or docs entry with the fields the comparison reads; the file is not trusted. */
function isEntry(entry: unknown): entry is CatalogEntry {
  if (typeof entry !== "object" || entry === null) {
    return false;
  }
  const { id, title, name } = entry as Record<string, unknown>;
  return typeof id === "string" && typeof title === "string" && typeof name === "string";
}

/** The baseline's and this build's catalog entries; null while either cannot be read or is malformed. */
async function entriesOf(
  deps: BuildStateDeps,
  where: Where,
): Promise<{ was: CatalogEntry[]; now: CatalogEntry[] } | null> {
  const { build, project } = where;
  const { storage } = deps;
  const baseline = storage === undefined ? null : await baselineBuildOf(deps, where);
  if (storage === undefined || baseline === null) {
    return null;
  }
  const [was, now] = await Promise.all([
    readCatalog(storage, project.id, baseline.id),
    readCatalog(storage, project.id, build.id),
  ]);
  if (was === null || now === null || !was.entries.every(isEntry) || !now.entries.every(isEntry)) {
    return null;
  }
  return { was: was.entries, now: now.entries };
}

/**
 * `Title / Name` of the stories the baseline's index had and this build's lacks, by story id. Left
 * out (undefined) while either index cannot be read, so a missing file never reads as every story gone.
 */
export async function removedStoriesOf(
  deps: BuildStateDeps,
  where: Where,
): Promise<string[] | undefined> {
  if (!COMPARABLE.has(where.build.status)) {
    return undefined;
  }
  const entries = await entriesOf(deps, where);
  if (entries === null) {
    return undefined;
  }
  const present = storiesOf(entries.now);
  const removed = [...storiesOf(entries.was)].filter(([id]) => !present.has(id));
  return removed.map(([, title]) => title);
}

/**
 * Rows of the branch before `build`, newest first: the read widens while newer builds fill it, until
 * `wanted` are found or the branch is exhausted.
 */
async function buildsBefore(
  deps: BuildStateDeps,
  where: Where,
  read: number,
): Promise<Awaited<ReturnType<BuildModel["listSummary"]>>> {
  const { build, project } = where;
  const rows = await new BuildModel(deps.db).listSummary(project.id, {
    branch: build.gitBranch,
    limit: read,
  });
  const before = rows.filter((row) => isBefore(row, build));
  const exhausted = rows.length < read;
  return before.length >= EARLIER_BUILDS_SHOWN || exhausted
    ? before
    : await buildsBefore(deps, where, read * 2);
}

/**
 * Builds of the same project and branch before this one, newest first, at most
 * {@link EARLIER_BUILDS_SHOWN}; each links to its build page. The state is a fixed phrase.
 */
export async function earlierBuildsOf(
  deps: BuildStateDeps,
  where: Where & { urls: UrlBuilder },
): Promise<BuildStateExtras["earlier"]> {
  const { project, urls } = where;
  const rows = await buildsBefore(deps, where, EARLIER_BUILDS_READ);
  return rows.slice(0, EARLIER_BUILDS_SHOWN).map((row) => ({
    state: STATE_BY_STATUS[row.status] ?? row.status,
    sha: row.gitSha.slice(0, 7),
    url: urls.build(project.slug, row.id),
  }));
}
