import { MemberModel, ProjectGroupMappingModel } from "@storyshelf/core/models";
import type { ProjectRole } from "@storyshelf/core/types";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { hxRedirect } from "./htmx.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";
/** Project member settings (assign roles, remove members). */
export function registerMemberSettings(app: ShelfRouter): void {
  app.get("/projects/:slug/settings/members", async (c) =>
    c.html(await renderSettingsPage(c, "members")),
  );

  app.post("/projects/:slug/settings/members", async (c) => {
    const project = await findProject(c.req.param("slug") ?? "");
    const form = await c.req.formData();
    const userId = asString(form.get("userId"));
    const role = asString(form.get("role"));
    if (!userId || !role) {
      return c.html(
        (await renderSettingsPage(c, "members", { globalError: "User and role are required" })) ??
          "",
        400,
      );
    }
    await new MemberModel(getStore().db, {
      projectMembers: getStore().db.tables.projectMembers,
    }).set(project.id, userId, role as ProjectRole);
    return hxRedirect(c, `/projects/${project.slug}/settings/members`);
  });

  app.post("/projects/:slug/settings/members/:userId/remove", async (c) => {
    const project = await findProject(c.req.param("slug") ?? "");
    await new MemberModel(getStore().db, {
      projectMembers: getStore().db.tables.projectMembers,
    }).remove(project.id, c.req.param("userId") ?? "");
    return hxRedirect(c, `/projects/${project.slug}/settings/members`);
  });

  registerGroupMappingSettings(app);
}

/** Identity-provider group mapping settings (exact-match group to role). */
function registerGroupMappingSettings(app: ShelfRouter): void {
  app.post("/projects/:slug/settings/members/groups", async (c) => {
    const project = await findProject(c.req.param("slug") ?? "");
    const form = await c.req.formData();
    const groupName = asString(form.get("groupName"));
    const role = asString(form.get("role")) as ProjectRole | undefined;
    if (!groupName || !role || !["viewer", "developer", "approver", "admin"].includes(role)) {
      return c.html(
        (await renderSettingsPage(c, "members", { globalError: "Group and role are required" })) ??
          "",
        400,
      );
    }
    await new ProjectGroupMappingModel(getStore().db, {
      projectGroupMappings: getStore().db.tables.projectGroupMappings,
    }).create(project.id, groupName, role);
    return hxRedirect(c, `/projects/${project.slug}/settings/members`);
  });

  app.post("/projects/:slug/settings/members/groups/:mappingId/remove", async (c) => {
    const project = await findProject(c.req.param("slug") ?? "");
    await new ProjectGroupMappingModel(getStore().db, {
      projectGroupMappings: getStore().db.tables.projectGroupMappings,
    }).remove(project.id, c.req.param("mappingId") ?? "");
    return hxRedirect(c, `/projects/${project.slug}/settings/members`);
  });
}
