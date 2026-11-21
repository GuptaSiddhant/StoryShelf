/** What the comment says about stories gone since the baseline and the builds before this one (ADR 0014). */
import type { BuildStateExtras } from "../../adapters/notifier/build-state.ts";
import { BuildModel } from "../../models/build.ts";
import type { Build } from "../../schema/build.ts";
import type { Project } from "../../schema/project.ts";
import type { BuildStatus } from "../../types.ts";
import type { UrlBuilder } from "../../urls.ts";
import { readCatalog } from "../catalog/catalogue.ts";
import type { CatalogEntry } from "../catalog/types.ts";
import type { BuildStateDeps } from "./types.ts";

/** Earlier builds listed in the comment, newest first. */
export const EARLIER_BUILDS_SHOWN = 10;

/** Builds read to find those before this one; newer builds of the branch are passed over. */
const EARLIER_BUILDS_READ = 50;

/** Removed stories handed to the comment, which lists a few and counts the rest. */
const REMOVED_READ = 100;

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

/** The newest approved build before `build` on its own branch, else on the default branch. */
async function baselineBuildOf(deps: BuildStateDeps, where: Where): Promise<Build | null> {
  const { build, project } = where;
  const builds = new BuildModel(deps.db);
  const before = (rows: readonly Build[]): Build | null =>
    rows.find((row) => isBefore(row, build)) ?? null;
  const own = before(
    await builds.list(project.id, { branch: build.gitBranch, status: "approved" }),
  );
  if (own !== null || build.gitBranch === project.gitDefaultBranch) {
    return own;
  }
  return before(
    await builds.list(project.id, { branch: project.gitDefaultBranch, status: "approved" }),
  );
}

function storiesOf(entries: readonly CatalogEntry[]): Map<string, string> {
  return new Map(
    entries
      .filter((entry) => entry.type === "story")
      .map((entry) => [entry.id, `${entry.title} / ${entry.name}`] as const),
  );
}

/** The baseline's and this build's catalog entries; null while either cannot be read. */
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
  return was === null || now === null ? null : { was: was.entries, now: now.entries };
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
  return removed.slice(0, REMOVED_READ).map(([, title]) => title);
}

/**
 * Builds of the same project and branch before this one, newest first, at most
 * {@link EARLIER_BUILDS_SHOWN}; each links to its build page. The state is a fixed phrase.
 */
export async function earlierBuildsOf(
  deps: BuildStateDeps,
  where: Where & { urls: UrlBuilder },
): Promise<BuildStateExtras["earlier"]> {
  const { build, project, urls } = where;
  const rows = await new BuildModel(deps.db).listSummary(project.id, {
    branch: build.gitBranch,
    limit: EARLIER_BUILDS_READ,
  });
  return rows
    .filter((row) => isBefore(row, build))
    .slice(0, EARLIER_BUILDS_SHOWN)
    .map((row) => ({
      state: STATE_BY_STATUS[row.status] ?? row.status,
      sha: row.gitSha.slice(0, 7),
      url: urls.build(project.slug, row.id),
    }));
}
