import type { Context } from "hono";
import type { ShelfApp } from "../index.tsx";
import { LabelModel } from "../models/label.ts";
import { getStore } from "../store.ts";
import { hxRedirect } from "./htmx.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";

/** Label-type settings (create custom types, delete removable ones). */
export function registerLabelSettings(app: ShelfApp): void {
  app.get("/projects/:slug/settings/labels", async (c) =>
    c.html(await renderSettingsPage(c, "labels")),
  );
  app.post("/projects/:slug/settings/labels", handleCreateLabelType);
  app.post("/projects/:slug/settings/labels/:key/delete", handleDeleteLabelType);
}

async function handleCreateLabelType(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const form = await c.req.formData();
  const key = asString(form.get("key"));
  const labelName = asString(form.get("labelName")) ?? asString(form.get("name"));
  const linkTemplate = asString(form.get("linkTemplate"));
  if (!key || !labelName) {
    return c.html(
      (await renderSettingsPage(c, "labels", { globalError: "Key and name are required" })) ?? "",
      400,
    );
  }
  return await persistLabelType(c, project.id, project.slug, key, labelName, linkTemplate);
}

async function persistLabelType(
  c: Context,
  projectId: string,
  projectSlug: string,
  key: string,
  labelName: string,
  linkTemplate: string | undefined,
): Promise<Response> {
  try {
    await new LabelModel(getStore().db).createType(projectId, {
      key,
      name: labelName,
      linkTemplate,
    });
    return hxRedirect(c, `/projects/${projectSlug}/settings/labels`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create label";
    return c.html((await renderSettingsPage(c, "labels", { globalError: message })) ?? "", 400);
  }
}

async function handleDeleteLabelType(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  try {
    await new LabelModel(getStore().db).removeType(project.id, c.req.param("key") ?? "");
  } catch {
    return c.html(
      (await renderSettingsPage(c, "labels", { globalError: "Cannot delete built-in label" })) ??
        "",
      400,
    );
  }
  return hxRedirect(c, `/projects/${project.slug}/settings/labels`);
}
