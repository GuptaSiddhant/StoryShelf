import {
  BuildModel,
  matchUpstreamStory,
  PackageUsageModel,
  ProjectModel,
  SnapshotModel,
} from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { ProjectRole } from "@storyshelf/core/types";
import type { LinkedUsageItem } from "../pages/build-diff-usage.tsx";
import { getStore } from "../store.ts";
import { resolveAuthorizedProject } from "./helpers.ts";

const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];

/** Upstream stories (latest approved default build) used to map package modules to stories. */
async function upstreamStories(
  upstream: Project,
): Promise<{ importPath: string; storyId: string }[]> {
  const build = await new BuildModel(getStore().db).latestApprovedDefault(upstream);
  if (!build) {
    return [];
  }
  const snapshots = await new SnapshotModel(getStore().db).listByBuild(build.id);
  return snapshots.flatMap((snapshot) =>
    snapshot.storyImportPath
      ? [{ importPath: snapshot.storyImportPath, storyId: snapshot.storyId }]
      : [],
  );
}

/** Linked-package usage of one story, omitting upstreams the viewer cannot open. */
export async function linkedUsageFor(
  c: Parameters<typeof resolveAuthorizedProject>[0],
  project: Project,
  buildId: string,
  storyImportPath: string | null,
): Promise<LinkedUsageItem[]> {
  if (!storyImportPath) {
    return [];
  }
  const model = new PackageUsageModel(getStore().db);
  const [rows, links] = await Promise.all([
    model.listForStory(buildId, storyImportPath),
    model.listLinks(project.id),
  ]);
  const items = await Promise.all(
    rows.map(async (row) => {
      const link = links.find((candidate) => candidate.packageName === row.packageName);
      const upstream = link ? await new ProjectModel(getStore().db).get(link.upstreamId) : null;
      if (!upstream) {
        return null;
      }
      const visible = await resolveAuthorizedProject(c, upstream.slug, ...VIEW_ROLES).catch(
        () => null,
      );
      if (!visible) {
        return null;
      }
      const stories = await upstreamStories(upstream);
      const upstreamBuild = await new BuildModel(getStore().db).latestApprovedDefault(upstream);
      return {
        package: row.packageName,
        version: row.version,
        upstreamSlug: upstream.slug,
        upstreamBuildId: upstreamBuild?.id ?? null,
        upstreamStoryId: matchUpstreamStory(row.modulePath, stories),
      };
    }),
  );
  return items.filter((item): item is LinkedUsageItem => item !== null);
}
