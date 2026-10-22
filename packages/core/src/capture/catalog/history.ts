/** A component across builds: which builds hold it, whether its stories changed, and where it went. */
import type { ComponentPresence } from "../../models/component.ts";
import type { BuildComponent } from "../../schema/build-component.ts";
import type { Build } from "../../schema/build.ts";

/** How a build's version of a component compares with the build before it on the same branch. */
export type ComponentChange = "new" | "changed" | "unchanged";

/** One build's row of a component's history. */
export interface ComponentBuildRow {
  build: Build;
  component: BuildComponent;
  change: ComponentChange;
  /** The same component in the build before on the branch; null when this is its first. */
  previous: BuildComponent | null;
}

/**
 * Component history, newest build first. `rows` are the component's `build_components` rows;
 * a row whose build is missing is skipped. The build before is the next older one on the same
 * branch, so a feature branch compares with itself rather than with an unrelated default build.
 */
export function componentBuildHistory(
  rows: readonly BuildComponent[],
  builds: readonly Build[],
): ComponentBuildRow[] {
  const byId = new Map(builds.map((build) => [build.id, build] as const));
  const known = rows
    .flatMap((component) => {
      const build = byId.get(component.buildId);
      return build ? [{ build, component }] : [];
    })
    .toSorted((a, b) => b.build.createdAt.localeCompare(a.build.createdAt));
  return known.map((entry, index) => {
    const previous =
      known.slice(index + 1).find((older) => older.build.gitBranch === entry.build.gitBranch)
        ?.component ?? null;
    const change: ComponentChange = previous
      ? previous.hash === entry.component.hash
        ? "unchanged"
        : "changed"
      : "new";
    return { build: entry.build, component: entry.component, change, previous };
  });
}

/**
 * Where a component stands against the project's latest build. `latest` holds that build's
 * component rows, or null when it has no catalog (the answer is then unknown, never "deleted").
 */
export function catalogPresence(
  history: readonly ComponentBuildRow[],
  importPath: string,
  latest: readonly BuildComponent[] | null,
): ComponentPresence {
  const newest = history[0];
  if (!latest || !newest) {
    return { kind: "unknown" };
  }
  if (latest.some((row) => row.importPath === importPath)) {
    return { kind: "present" };
  }
  const moved = latest.find((row) => row.title === newest.component.title && row.importPath !== "");
  return moved
    ? { kind: "moved", to: moved.importPath, title: moved.title }
    : { kind: "deleted", lastSeen: newest.build };
}
