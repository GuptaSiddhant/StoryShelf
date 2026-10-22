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
import { catalogOf, getStore } from "../store.ts";
import { resolveAuthorizedProject } from "./helpers.ts";

const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];

type Caller = Parameters<typeof resolveAuthorizedProject>[0];

/** What a link resolves to: the upstream project's latest published build and its stories. */
interface ResolvedUpstream {
  slug: string;
  buildId: string | null;
  stories: { importPath: string; storyId: string }[];
}

/**
 * Upstream project resolved from its latest approved default build: its stories from the build's
 * snapshots when it has them, from its Storybook catalog otherwise (a hosting-only build).
 */
async function resolveUpstream(upstream: Project): Promise<ResolvedUpstream> {
  const build = await new BuildModel(getStore().db).latestApprovedDefault(upstream);
  const snapshots = build ? await new SnapshotModel(getStore().db).listByBuild(build.id) : [];
  const stories = snapshots.flatMap((snapshot) =>
    snapshot.storyImportPath
      ? [{ importPath: snapshot.storyImportPath, storyId: snapshot.storyId }]
      : [],
  );
  return {
    slug: upstream.slug,
    buildId: build?.id ?? null,
    stories: stories.length > 0 || !build ? stories : await catalogStories(upstream, build.id),
  };
}

async function catalogStories(
  upstream: Project,
  buildId: string,
): Promise<ResolvedUpstream["stories"]> {
  const catalog = await catalogOf()
    .load(upstream.id, buildId)
    .catch(() => null);
  return (catalog?.entries ?? []).flatMap((entry) =>
    entry.type === "story" && entry.importPath
      ? [{ importPath: entry.importPath, storyId: entry.id }]
      : [],
  );
}

/** Resolve each linked package once; upstreams the viewer cannot open are omitted. */
async function resolveLinkedUpstreams(
  c: Caller,
  project: Project,
  packages: Set<string>,
): Promise<Map<string, ResolvedUpstream>> {
  const links = (await new PackageUsageModel(getStore().db).listLinks(project.id)).filter((link) =>
    packages.has(link.packageName),
  );
  const resolved = await Promise.all(
    links.map(async (link) => {
      const upstream = await new ProjectModel(getStore().db).get(link.upstreamId);
      const visible = upstream
        ? await resolveAuthorizedProject(c, upstream.slug, ...VIEW_ROLES).catch(() => null)
        : null;
      return upstream && visible
        ? ([link.packageName, await resolveUpstream(upstream)] as const)
        : null;
    }),
  );
  return new Map(resolved.filter((entry) => entry !== null));
}

/**
 * Linked-package usage grouped by story file, resolved with one pass over the
 * build's usage rows and one lookup per linked upstream (never per story).
 * Omits upstreams the viewer cannot open; pass `storyImportPath` to narrow to one story.
 */
export async function linkedUsageByStory(
  c: Caller,
  project: Project,
  buildId: string,
  storyImportPath?: string,
): Promise<Map<string, LinkedUsageItem[]>> {
  const model = new PackageUsageModel(getStore().db);
  const rows = storyImportPath
    ? await model.listForStory(buildId, storyImportPath)
    : await model.listForBuild(buildId);
  const upstreams = await resolveLinkedUpstreams(
    c,
    project,
    new Set(rows.map((row) => row.packageName)),
  );
  const byStory = new Map<string, LinkedUsageItem[]>();
  for (const row of rows) {
    const upstream = upstreams.get(row.packageName);
    if (upstream) {
      const upstreamStoryId = matchUpstreamStory(row.modulePath, upstream.stories);
      byStory.set(row.storyImportPath, [
        ...(byStory.get(row.storyImportPath) ?? []),
        {
          package: row.packageName,
          version: row.version,
          upstreamSlug: upstream.slug,
          upstreamBuildId: upstream.buildId,
          upstreamStoryId,
          upstreamImportPath:
            upstream.stories.find((story) => story.storyId === upstreamStoryId)?.importPath ?? null,
        },
      ]);
    }
  }
  return byStory;
}

/** Linked-package usage of one story, omitting upstreams the viewer cannot open. */
export async function linkedUsageFor(
  c: Caller,
  project: Project,
  buildId: string,
  storyImportPath: string | null,
): Promise<LinkedUsageItem[]> {
  if (!storyImportPath) {
    return [];
  }
  return (
    (await linkedUsageByStory(c, project, buildId, storyImportPath)).get(storyImportPath) ?? []
  );
}
