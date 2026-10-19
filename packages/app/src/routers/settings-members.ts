import { MemberModel, ProjectGroupMappingModel } from "@storyshelf/core/models";
import { isProjectRole } from "@storyshelf/core/types";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
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
    if (!userId || !isProjectRole(role)) {
      return c.html(
        (await renderSettingsPage(c, "members", { globalError: "User and role are required" })) ??
          "",
        400,
      );
    }
    await new MemberModel(getStore().db).set(project.id, userId, role);
    flash(c, "Member saved");
    return hxRedirect(c, `/projects/${project.slug}/settings/members`);
  });

  app.post("/projects/:slug/settings/members/:userId/remove", async (c) => {
    const project = await findProject(c.req.param("slug") ?? "");
    await new MemberModel(getStore().db).remove(project.id, c.req.param("userId") ?? "");
    flash(c, "Member removed");
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
    const role = asString(form.get("role"));
    const inputError = ProjectGroupMappingModel.inputError(groupName, role);
    if (inputError || !groupName || !isProjectRole(role)) {
      return c.html(
        (await renderSettingsPage(c, "members", { globalError: inputError ?? "Invalid input" })) ??
          "",
        400,
      );
    }
    await new ProjectGroupMappingModel(getStore().db).create(project.id, groupName, role);
    flash(c, "Group mapping added");
    return hxRedirect(c, `/projects/${project.slug}/settings/members`);
  });

  app.post("/projects/:slug/settings/members/groups/:mappingId/remove", async (c) => {
    const project = await findProject(c.req.param("slug") ?? "");
    await new ProjectGroupMappingModel(getStore().db).remove(
      project.id,
      c.req.param("mappingId") ?? "",
    );
    flash(c, "Group mapping removed");
    return hxRedirect(c, `/projects/${project.slug}/settings/members`);
  });
}
