import { createRoute, z } from "@hono/zod-openapi";
import { modeSlug } from "@storyshelf/core/capture";
import { LabelModel } from "@storyshelf/core/models";
import { MemberModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import type { ProjectRole } from "@storyshelf/core/types";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { forbidden, requireSiteAdmin, resolveAuthorizedProject } from "./helpers.ts";
import {
  badRequest,
  forbidden as forbiddenResponse,
  notFound,
  projectCreateSchema,
  projectSchema,
  projectUpdateSchema,
  unauthorized,
} from "./schemas.ts";
const VIEW_ROLES: readonly ProjectRole[] = ["viewer", "developer", "approver", "admin"];
const ADMIN_ROLES: readonly ProjectRole[] = ["admin"];

function requireSessionUser(): void {
  if (!getStore().authEnabled) {
    return;
  }
  if (!getStore().user) {
    forbidden();
  }
}

const listProjectsRoute = createRoute({
  method: "get",
  tags: ["Projects"],
  summary: "List projects",
  path: "/api/v1/projects",
  responses: {
    200: {
      content: { "application/json": { schema: projectSchema.array() } },
      description: "List projects",
    },
    ...unauthorized,
  },
});

const createProjectRoute = createRoute({
  method: "post",
  tags: ["Projects"],
  summary: "Create a project",
  path: "/api/v1/projects",
  request: { body: { content: { "application/json": { schema: projectCreateSchema } } } },
  responses: {
    201: {
      content: { "application/json": { schema: projectSchema } },
      description: "Created project",
    },
    ...badRequest,
    ...forbiddenResponse,
    ...unauthorized,
  },
});

const getProjectRoute = createRoute({
  method: "get",
  tags: ["Projects"],
  summary: "Get a project",
  path: "/api/v1/projects/{slug}",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: projectSchema } },
      description: "Fetch a project",
    },
    ...notFound,
    ...unauthorized,
  },
});

const updateProjectRoute = createRoute({
  method: "patch",
  tags: ["Projects"],
  summary: "Update a project",
  path: "/api/v1/projects/{slug}",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "application/json": { schema: projectUpdateSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: projectSchema } },
      description: "Updated project",
    },
    ...forbiddenResponse,
    ...notFound,
  },
});

const deleteProjectRoute = createRoute({
  method: "delete",
  tags: ["Projects"],
  summary: "Delete a project",
  path: "/api/v1/projects/{slug}",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    204: { description: "Deleted project" },
    ...forbiddenResponse,
    ...notFound,
  },
});

/** `aiProfile` is a site-admin data-flow decision; it must name a configured profile. */
function assertAiProfileChange(c: Context, profile: string | null | undefined): void {
  if (profile === undefined) {
    return;
  }
  requireSiteAdmin(c);
  const { ai } = getStore();
  if (profile !== null && !ai?.profileNames().includes(profile)) {
    throw new HTTPException(400, { message: `Unknown AI profile "${profile}"` });
  }
}

type ProjectUpdate = z.infer<typeof projectUpdateSchema>;

/**
 * Translate the API's array fields into the stored JSON columns and keep the
 * legacy `browser` column equal to the primary engine.
 */
function toProjectPatch(body: ProjectUpdate): Record<string, unknown> {
  const { browsers, modesAllowlist, ...rest } = body;
  const patch: Record<string, unknown> = { ...rest };
  if (browsers !== undefined) {
    const unique = browsers === null ? null : [...new Set(browsers)];
    patch["browsers"] = unique ? JSON.stringify(unique) : null;
    if (unique?.[0]) patch["browser"] = unique[0];
  } else if (rest.browser !== undefined) {
    patch["browsers"] = null;
  }
  if (modesAllowlist !== undefined) {
    patch["modesAllowlist"] = modesAllowlist
      ? JSON.stringify(assertModeNames(modesAllowlist))
      : null;
  }
  return patch;
}

function assertModeNames(names: string[]): string[] {
  for (const name of names) {
    try {
      modeSlug(name);
    } catch {
      throw new HTTPException(400, { message: `Invalid mode name "${name}"` });
    }
  }
  return [...new Set(names)];
}

/** Register the project list, create, fetch, update, and delete endpoints. */
export function registerProjects(app: ShelfRouter): void {
  app.openapi(listProjectsRoute, async (c) => {
    requireSessionUser();
    const projects = new ProjectModel(getStore().db);
    return c.json(await projects.list());
  });

  app.openapi(createProjectRoute, async (c) => {
    requireSiteAdmin(c);
    const body = c.req.valid("json");
    const projects = new ProjectModel(getStore().db);
    const project = await projects.create(body);
    await new LabelModel(getStore().db).seedFor(project.id);
    const creator = getStore().user;
    if (creator) {
      await new MemberModel(getStore().db).set(project.id, creator.id, "admin");
    }
    return c.json(project, 201);
  });

  app.openapi(getProjectRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...VIEW_ROLES);
    return c.json(project);
  });

  app.openapi(updateProjectRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...ADMIN_ROLES);
    const body = c.req.valid("json");
    assertAiProfileChange(c, body.aiProfile);
    const updated = await new ProjectModel(getStore().db).update(project.id, toProjectPatch(body));
    return c.json(updated);
  });

  app.openapi(deleteProjectRoute, async (c) => {
    requireSiteAdmin(c);
    const { slug } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...VIEW_ROLES);
    await new ProjectModel(getStore().db).remove(project.id);
    return c.body(null, 204);
  });
}
