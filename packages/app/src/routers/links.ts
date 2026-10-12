import { createRoute, z } from "@hono/zod-openapi";
import {
  BuildModel,
  matchUpstreamStory,
  PackageUsageModel,
  ProjectModel,
  SnapshotModel,
} from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { ProjectRole } from "@storyshelf/core/types";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { buildForProject, snapshotForBuild } from "./builds.handlers.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { badRequest, forbidden, notFound, unauthorized } from "./schemas.ts";

const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];
const ADMIN_ROLES: readonly ProjectRole[] = ["admin"];

const linkSchema = z.object({
  package: z.string().min(1).max(214),
  upstreamSlug: z.string().min(1),
});
const linksBodySchema = z.object({ links: z.array(linkSchema).max(200) });
const usageItemSchema = z.object({
  package: z.string(),
  version: z.string().nullable(),
  upstreamSlug: z.string(),
  /** Upstream story the package module maps to; null falls back to the library. */
  upstreamStoryId: z.string().nullable(),
});

const projectParams = z.object({ slug: z.string() });

const listLinksRoute = createRoute({
  method: "get",
  tags: ["Links"],
  summary: "List the packages this project consumes from other projects",
  path: "/api/v1/projects/{slug}/links",
  request: { params: projectParams },
  responses: {
    200: {
      content: { "application/json": { schema: linksBodySchema } },
      description: "Package links of the project",
    },
    ...notFound,
    ...unauthorized,
  },
});

const putLinksRoute = createRoute({
  method: "put",
  tags: ["Links"],
  summary: "Replace the packages this project consumes from other projects",
  path: "/api/v1/projects/{slug}/links",
  request: {
    params: projectParams,
    body: { content: { "application/json": { schema: linksBodySchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: linksBodySchema } },
      description: "Links replaced",
    },
    ...badRequest,
    ...forbidden,
    ...notFound,
  },
});

const usageRoute = createRoute({
  method: "get",
  tags: ["Links"],
  summary: "Linked packages a snapshot's story uses",
  path: "/api/v1/projects/{slug}/builds/{buildId}/snapshots/{snapshotId}/usage",
  request: {
    params: z.object({ slug: z.string(), buildId: z.string(), snapshotId: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: usageItemSchema.array() } },
      description: "Usage of linked packages; empty when the build reported none",
    },
    ...notFound,
    ...unauthorized,
  },
});

/** Resolve link slugs to projects, rejecting unknown, self, duplicate, or unviewable ones. */
async function resolveLinkTargets(
  c: Parameters<typeof resolveAuthorizedProject>[0],
  project: Project,
  links: z.infer<typeof linkSchema>[],
): Promise<{ upstreamId: string; packageName: string }[]> {
  if (new Set(links.map((link) => link.package)).size !== links.length) {
    throw new HTTPException(400, { message: "Each package can be linked once" });
  }
  return await Promise.all(
    links.map(async (link) => {
      if (link.upstreamSlug === project.slug) {
        throw new HTTPException(400, { message: "A project cannot link to itself" });
      }
      const upstream = await resolveAuthorizedProject(c, link.upstreamSlug, ...VIEW_ROLES).catch(
        () => {
          throw new HTTPException(400, { message: `Unknown project: ${link.upstreamSlug}` });
        },
      );
      return { upstreamId: upstream.id, packageName: link.package };
    }),
  );
}

/** Links of a project as API shape, dropping upstreams that no longer exist. */
async function linkViews(project: Project): Promise<z.infer<typeof linkSchema>[]> {
  const db = getStore().db;
  const links = await new PackageUsageModel(db).listLinks(project.id);
  const views = await Promise.all(
    links.map(async (link) => {
      const upstream = await new ProjectModel(db).get(link.upstreamId);
      return upstream ? { package: link.packageName, upstreamSlug: upstream.slug } : null;
    }),
  );
  return views.filter((view): view is z.infer<typeof linkSchema> => view !== null);
}

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

/** Register the package-link and snapshot-usage endpoints. */
export function registerLinks(app: ShelfRouter): void {
  app.openapi(listLinksRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...VIEW_ROLES);
    return c.json({ links: await linkViews(project) });
  });

  app.openapi(putLinksRoute, async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.valid("param").slug, ...ADMIN_ROLES);
    const { links } = c.req.valid("json");
    const targets = await resolveLinkTargets(c, project, links);
    await new PackageUsageModel(getStore().db).replaceLinks(project.id, targets);
    return c.json({ links: await linkViews(project) });
  });

  app.openapi(usageRoute, async (c) => {
    const { slug, buildId, snapshotId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...VIEW_ROLES);
    const build = await buildForProject(project.id, buildId);
    const snapshot = await snapshotForBuild(build, snapshotId);
    return c.json(await usageFor(c, project, build.id, snapshot.storyImportPath));
  });
}

/** Linked-package usage of one story, omitting upstreams the viewer cannot open. */
async function usageFor(
  c: Parameters<typeof resolveAuthorizedProject>[0],
  project: Project,
  buildId: string,
  storyImportPath: string | null,
): Promise<z.infer<typeof usageItemSchema>[]> {
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
      return {
        package: row.packageName,
        version: row.version,
        upstreamSlug: upstream.slug,
        upstreamStoryId: matchUpstreamStory(row.modulePath, stories),
      };
    }),
  );
  return items.filter((item): item is z.infer<typeof usageItemSchema> => item !== null);
}
