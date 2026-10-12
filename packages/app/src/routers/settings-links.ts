import { PackageUsageModel, ProjectModel } from "@storyshelf/core/models";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { hxRedirect } from "./htmx.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";

/** Package-link settings (link a consumed package to its upstream project, or unlink it). */
export function registerLinkSettings(app: ShelfRouter): void {
  app.get("/projects/:slug/settings/links", async (c) =>
    c.html(await renderSettingsPage(c, "links")),
  );
  app.post("/projects/:slug/settings/links", handleAddLink);
  app.post("/projects/:slug/settings/links/delete", handleRemoveLink);
}

async function rejectLink(c: Context, message: string): Promise<Response> {
  return c.html((await renderSettingsPage(c, "links", { globalError: message })) ?? "", 400);
}

/** Replace one package's link, keeping the project's other links. */
async function saveLink(
  project: { id: string },
  packageName: string,
  upstreamId: string,
): Promise<void> {
  const model = new PackageUsageModel(getStore().db);
  const kept = (await model.listLinks(project.id)).filter(
    (link) => link.packageName !== packageName,
  );
  await model.replaceLinks(project.id, [
    ...kept.map((link) => ({ upstreamId: link.upstreamId, packageName: link.packageName })),
    { upstreamId, packageName },
  ]);
}

/** Read the add-link form fields. */
async function readLinkForm(c: Context): Promise<{ packageName?: string; upstreamSlug?: string }> {
  const form = await c.req.formData();
  return {
    packageName: asString(form.get("package")),
    upstreamSlug: asString(form.get("upstreamSlug")),
  };
}

async function handleAddLink(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const { packageName, upstreamSlug } = await readLinkForm(c);
  const upstream = upstreamSlug
    ? await new ProjectModel(getStore().db).getBySlug(upstreamSlug)
    : null;
  if (!packageName || !upstream || upstream.id === project.id) {
    return await rejectLink(c, "Enter a package and choose a different, existing upstream project");
  }
  await saveLink(project, packageName, upstream.id);
  flash(c, "Package linked");
  return hxRedirect(c, `/projects/${project.slug}/settings/links`);
}

async function handleRemoveLink(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const packageName = asString((await c.req.formData()).get("package"));
  const model = new PackageUsageModel(getStore().db);
  const kept = (await model.listLinks(project.id)).filter(
    (link) => link.packageName !== packageName,
  );
  await model.replaceLinks(
    project.id,
    kept.map((link) => ({ upstreamId: link.upstreamId, packageName: link.packageName })),
  );
  flash(c, "Link removed");
  return hxRedirect(c, `/projects/${project.slug}/settings/links`);
}
