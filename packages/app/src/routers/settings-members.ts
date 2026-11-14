import {
  MemberModel,
  parseOwnerRules,
  ProjectGroupMappingModel,
  ProjectModel,
  serializeOwnerRules,
  UserModel,
} from "@storyshelf/core/models";
import { isProjectRole } from "@storyshelf/core/types";
import type { ShelfRouter } from "../app-types.ts";
import { settingsHref } from "../pages/settings-tabs.ts";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { hxRedirect } from "./htmx.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";
/** Project member settings (assign roles, remove members). */
export function registerMemberSettings(app: ShelfRouter): void {
  app.post("/projects/:slug/settings/members", async (c) => {
    const project = await findProject(c.req.param("slug") ?? "");
    const form = await c.req.formData();
    const role = asString(form.get("role"));
    const userId = await resolveMemberUser(form);
    if (!userId.id || !isProjectRole(role)) {
      return c.html(
        (await renderSettingsPage(c, "members", { globalError: userId.error })) ?? "",
        400,
      );
    }
    await new MemberModel(getStore().db).set(project.id, userId.id, role);
    flash(c, "Member saved");
    return hxRedirect(c, settingsHref(project.slug, "members"));
  });

  app.post("/projects/:slug/settings/members/:userId/remove", async (c) => {
    const project = await findProject(c.req.param("slug") ?? "");
    await new MemberModel(getStore().db).remove(project.id, c.req.param("userId") ?? "");
    flash(c, "Member removed");
    return hxRedirect(c, settingsHref(project.slug, "members"));
  });

  registerOwnerSettings(app);
  registerGroupMappingSettings(app);
}

/** The user an add-member form names: an email (the form) or a raw id (API-style posts). */
async function resolveMemberUser(form: FormData): Promise<{ id?: string; error: string }> {
  const email = asString(form.get("email"));
  const rawId = asString(form.get("userId"));
  if (!email && !rawId) return { error: "Enter the member's email and a role" };
  if (!email) return { id: rawId, error: "User and role are required" };
  const user = await new UserModel(getStore().db).getByEmail(email);
  if (!user) {
    return { error: `No account has the email ${email}. They need to sign in once first.` };
  }
  return { id: user.id, error: "User and role are required" };
}

/**
 * Component owners (#465): globs to member ids, edited as one CODEOWNERS-style text. Project
 * admins only. Every line is checked against the project's members and nothing is saved unless all
 * pass; a refusal shows the lines and keeps the text as typed. A `review` route: 404 while review
 * is off.
 */
function registerOwnerSettings(app: ShelfRouter): void {
  app.post("/projects/:slug/settings/members/owners", async (c) => {
    const project = await resolveAuthorizedProject(c, c.req.param("slug") ?? "", "admin");
    const text = asString((await c.req.formData()).get("owners")) ?? "";
    const members = await new MemberModel(getStore().db).list(project.id);
    const { rules, problems } = parseOwnerRules(text, new Set(members.map((m) => m.userId)));
    if (problems.length > 0) {
      const state = { ownerText: text, ownerProblems: problems };
      return c.html((await renderSettingsPage(c, "owners", state)) ?? "", 400);
    }
    await new ProjectModel(getStore().db).update(project.id, {
      componentOwners: serializeOwnerRules(rules),
    });
    flash(c, "Component owners saved");
    return hxRedirect(c, settingsHref(project.slug, "owners"));
  });
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
    return hxRedirect(c, settingsHref(project.slug, "members"));
  });

  app.post("/projects/:slug/settings/members/groups/:mappingId/remove", async (c) => {
    const project = await findProject(c.req.param("slug") ?? "");
    await new ProjectGroupMappingModel(getStore().db).remove(
      project.id,
      c.req.param("mappingId") ?? "",
    );
    flash(c, "Group mapping removed");
    return hxRedirect(c, settingsHref(project.slug, "members"));
  });
}
