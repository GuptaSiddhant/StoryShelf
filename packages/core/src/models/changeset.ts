/**
 * The changeset of a build without screenshots (ADR 0013, decision 8): which components the build
 * added, removed or changed against its baseline build, from the `build_components` hashes. A
 * changed hash means the component's stories changed, not that anything looks different.
 */
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { BuildComponent } from "../schema/build-component.ts";
import type { Build } from "../schema/build.ts";
import { BuildComponentModel } from "./build-component.ts";
import { BuildModel } from "./build.ts";

/** What the changeset shows of a component. */
export type ChangesetComponent = Pick<BuildComponent, "importPath" | "title" | "storyCount">;

/** A component present in both builds whose hash differs. */
export interface ChangedComponent extends ChangesetComponent {
  /** Stories in the baseline build's version. */
  previousStoryCount: number;
}

/** Components added, removed and changed from a baseline build to a build. */
export interface Changeset {
  added: ChangesetComponent[];
  removed: ChangesetComponent[];
  changed: ChangedComponent[];
  /** Components with the same hash in both builds. */
  unchanged: number;
}

/** A build's changeset and what it was measured against. */
export interface BuildChangeset {
  /** The baseline build; null when there is none (every component then counts as added). */
  baseline: Build | null;
  changeset: Changeset;
}

/**
 * Compare a build's components with the baseline's. Components match by story file, or by title
 * when the index carries no file. With no baseline (`null`) every component is `added`.
 */
export function computeChangeset(
  current: readonly BuildComponent[],
  baseline: readonly BuildComponent[] | null,
): Changeset {
  const was = new Map((baseline ?? []).map((row) => [keyOf(row), row] as const));
  const now = new Map(current.map((row) => [keyOf(row), row] as const));
  const changeset: Changeset = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const [key, row] of now) {
    place(changeset, row, was.get(key));
  }
  for (const [key, row] of was) {
    if (!now.has(key)) {
      changeset.removed.push(summary(row));
    }
  }
  return {
    ...changeset,
    added: changeset.added.toSorted(byTitle),
    removed: changeset.removed.toSorted(byTitle),
    changed: changeset.changed.toSorted(byTitle),
  };
}

/** File `row` under added, changed or unchanged, given the baseline's version of it. */
function place(
  changeset: Changeset,
  row: BuildComponent,
  before: BuildComponent | undefined,
): void {
  if (before === undefined) {
    changeset.added.push(summary(row));
  } else if (before.hash === row.hash) {
    changeset.unchanged += 1;
  } else {
    changeset.changed.push({ ...summary(row), previousStoryCount: before.storyCount });
  }
}

/**
 * The build a build is compared with: the latest accepted build of its branch before it, else the
 * latest accepted default-branch build (the rule baselines use). Null for the first build.
 */
export async function findChangesetBaseline(
  db: DatabaseAdapter,
  project: { id: string; gitDefaultBranch: string },
  build: Build,
): Promise<Build | null> {
  const builds = new BuildModel(db);
  const branches = [...new Set([build.gitBranch, project.gitDefaultBranch])];
  const lists = await Promise.all(
    branches.map(async (branch) => await builds.list(project.id, { branch, status: "approved" })),
  );
  for (const accepted of lists) {
    const baseline = accepted.find(
      (candidate) => candidate.id !== build.id && candidate.createdAt < build.createdAt,
    );
    if (baseline) {
      return baseline;
    }
  }
  return null;
}

/** The changeset of `build` against its baseline; empty rows on both sides when it has no catalog. */
export async function changesetOf(
  db: DatabaseAdapter,
  project: { id: string; gitDefaultBranch: string },
  build: Build,
): Promise<BuildChangeset> {
  const components = new BuildComponentModel(db);
  const baseline = await findChangesetBaseline(db, project, build);
  const [current, before] = await Promise.all([
    components.listByBuild(build.id),
    baseline ? components.listByBuild(baseline.id) : Promise.resolve(null),
  ]);
  return { baseline, changeset: computeChangeset(current, before) };
}

function keyOf(row: Pick<BuildComponent, "importPath" | "title">): string {
  return row.importPath === "" ? `title:${row.title}` : row.importPath;
}

function summary(row: BuildComponent): ChangesetComponent {
  return { importPath: row.importPath, title: row.title, storyCount: row.storyCount };
}

function byTitle(a: ChangesetComponent, b: ChangesetComponent): number {
  return a.title.localeCompare(b.title) || a.importPath.localeCompare(b.importPath);
}
