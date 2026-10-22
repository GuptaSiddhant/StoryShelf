import { LabelModel } from "@storyshelf/core/models";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { hxRedirect } from "./htmx.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";
/** Label-type settings (create custom types, delete removable ones). */
export function registerLabelSettings(app: ShelfRouter): void {
  app.get("/projects/:slug/settings/labels", async (c) =>
    c.html(await renderSettingsPage(c, "labels", { editKey: c.req.query("edit") })),
  );
  app.post("/projects/:slug/settings/labels", handleCreateLabelType);
  app.post("/projects/:slug/settings/labels/:key", handleUpdateLabelType);
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
    flash(c, "Label type added");
    return hxRedirect(c, `/projects/${projectSlug}/settings/labels`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create label";
    return c.html((await renderSettingsPage(c, "labels", { globalError: message })) ?? "", 400);
  }
}

async function handleUpdateLabelType(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const key = c.req.param("key") ?? "";
  const form = await c.req.formData();
  const name = asString(form.get("labelName"));
  if (!name) {
    return c.html(
      (await renderSettingsPage(c, "labels", { globalError: "Name is required", editKey: key })) ??
        "",
      400,
    );
  }
  const template = asString(form.get("linkTemplate"));
  const linkTemplate = template === undefined || template === "" ? null : template;
  return await persistLabelUpdate(c, project, key, { name, linkTemplate });
}

async function persistLabelUpdate(
  c: Context,
  project: { id: string; slug: string },
  key: string,
  input: { name: string; linkTemplate: string | null },
): Promise<Response> {
  try {
    const updated = await new LabelModel(getStore().db).updateType(project.id, key, input);
    if (!updated) {
      throw new Error("Label type not found");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update label";
    return c.html((await renderSettingsPage(c, "labels", { globalError: message })) ?? "", 400);
  }
  flash(c, "Label type saved");
  return hxRedirect(c, `/projects/${project.slug}/settings/labels`);
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
  flash(c, "Label type deleted");
  return hxRedirect(c, `/projects/${project.slug}/settings/labels`);
}
