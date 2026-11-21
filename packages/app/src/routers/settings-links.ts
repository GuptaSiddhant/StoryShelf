import { PackageUsageModel } from "@storyshelf/core/models";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { settingsHref } from "../pages/settings-tabs.ts";
import { getStore } from "../store.ts";
import { VIEW_ROLES } from "./builds.handlers.ts";
import { flash } from "./flash.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { hxRedirect } from "./htmx.ts";
import { asString, renderSettingsPage } from "./settings.handlers.ts";

/** Package-link settings (link a consumed package to its upstream project, or unlink it). */
export function registerLinkSettings(app: ShelfRouter): void {
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
  const project = await resolveAuthorizedProject(c, c.req.param("slug") ?? "", "admin");
  const { packageName, upstreamSlug } = await readLinkForm(c);
  // As `PUT /api/v1/projects/:slug/links`: the upstream must be a project the caller may view.
  const upstream = upstreamSlug
    ? await resolveAuthorizedProject(c, upstreamSlug, ...VIEW_ROLES).catch(() => null)
    : null;
  if (!packageName || !upstream || upstream.id === project.id) {
    return await rejectLink(c, "Enter a package and choose a different, existing upstream project");
  }
  await saveLink(project, packageName, upstream.id);
  flash(c, "Package linked");
  return hxRedirect(c, settingsHref(project.slug, "links"));
}

async function handleRemoveLink(c: Context): Promise<Response> {
  const project = await resolveAuthorizedProject(c, c.req.param("slug") ?? "", "admin");
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
  return hxRedirect(c, settingsHref(project.slug, "links"));
}
