import type { ShelfApp } from "../index.tsx";
import { MemberModel } from "../models/member.ts";
import { getStore } from "../store.ts";
import { hxRedirect } from "./htmx.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";

/** Project member settings (assign roles, remove members). */
export function registerMemberSettings(app: ShelfApp): void {
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
    await new MemberModel(getStore().db).set(project.id, userId, role as never);
    return hxRedirect(c, `/projects/${project.slug}/settings/members`);
  });

  app.post("/projects/:slug/settings/members/:userId/remove", async (c) => {
    const project = await findProject(c.req.param("slug") ?? "");
    await new MemberModel(getStore().db).remove(project.id, c.req.param("userId") ?? "");
    return hxRedirect(c, `/projects/${project.slug}/settings/members`);
  });
}
