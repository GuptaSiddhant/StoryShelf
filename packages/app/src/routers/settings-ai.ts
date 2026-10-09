import type { Ai } from "@storyshelf/core/ai";
import { ProjectModel } from "@storyshelf/core/models";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { requireSiteAdmin } from "./helpers.ts";
import { hxRedirect } from "./htmx.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";

/** Register the project AI settings tab (site admins set the profile gate). */
export function registerAiSettings(app: ShelfRouter): void {
  app.get("/projects/:slug/settings/ai", async (c) => c.html(await renderSettingsPage(c, "ai")));
  app.post("/projects/:slug/settings/ai", handleAiUpdate);
}

/** Error text for an unusable choice, or null when it is allowed. */
function profileError(ai: Ai | undefined, requested: string): string | null {
  if (!ai) {
    return "AI is not configured";
  }
  return requested !== "" && !ai.profileNames().includes(requested)
    ? `Unknown profile "${requested}"`
    : null;
}

async function handleAiUpdate(c: Context): Promise<Response> {
  requireSiteAdmin(c);
  const { ai, db } = getStore();
  const project = await findProject(c.req.param("slug") ?? "");
  const requested = asString((await c.req.formData()).get("aiProfile")) ?? "";
  const error = profileError(ai, requested);
  if (error) {
    return c.html(await renderSettingsPage(c, "ai", { globalError: error }), 400);
  }
  await new ProjectModel(db).update(project.id, { aiProfile: requested === "" ? null : requested });
  flash(c, requested === "" ? "AI turned off for this project" : "AI profile saved");
  return hxRedirect(c, `/projects/${project.slug}/settings/ai`);
}
