import { InvalidDesignUrlError, type DesignProvider } from "@storyshelf/core/adapter/design";
import { DesignCredentialModel, DesignModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { credentialKeys } from "../credential-keys.ts";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { notFound, resolveAuthorizedProject } from "./helpers.ts";
import { hxRedirect } from "./htmx.ts";
import { asString, renderSettingsPage } from "./settings.handlers.ts";

/** Design settings (project design files, component mapping, provider credentials). */
export function registerDesignSettings(app: ShelfRouter): void {
  const base = "/projects/:slug/settings/design";
  app.get(base, async (c) => c.html(await renderSettingsPage(c, "design")));
  app.post(`${base}/files`, handleAddFile);
  app.post(`${base}/files/:id/delete`, handleRemoveLink);
  app.post(`${base}/components`, handleMapComponent);
  app.post(`${base}/components/:id/delete`, handleRemoveLink);
  app.post(`${base}/:provider/token`, handleSetToken);
  app.post(`${base}/:provider/token/delete`, handleRemoveToken);
}

/**
 * Every design-settings mutation writes credentials or mappings: require a
 * project admin server-side (the forms are only hidden from others, never trusted).
 * With auth disabled the app has no roles and everyone may administer, as elsewhere.
 */
async function adminProject(c: Context): Promise<Project> {
  return await resolveAuthorizedProject(c, c.req.param("slug") ?? "", "admin");
}

function designModel(): DesignModel {
  const { db, design } = getStore();
  return new DesignModel(db, design);
}

function credentialModel(): DesignCredentialModel {
  const { db, config } = getStore();
  return new DesignCredentialModel(db, credentialKeys(config));
}

/** The configured provider addressed by `:provider`, or a 404. */
function providerOf(c: Context): DesignProvider {
  const provider = getStore().design.find(
    (candidate) => candidate.metadata.kind === c.req.param("provider"),
  );
  if (!provider) notFound("Unknown design provider");
  return provider;
}

async function reject(c: Context, errors: Record<string, string>): Promise<Response> {
  return c.html((await renderSettingsPage(c, "design", { errors })) ?? "", 400);
}

function done(c: Context, slug: string, message: string): Response {
  flash(c, message);
  return hxRedirect(c, `/projects/${slug}/settings/design`);
}

async function handleAddFile(c: Context): Promise<Response> {
  const project = await adminProject(c);
  const form = await c.req.formData();
  const label = asString(form.get("label")) ?? "";
  try {
    await designModel().addProjectLink(project.id, { label, url: asString(form.get("url")) ?? "" });
  } catch (error) {
    if (error instanceof InvalidDesignUrlError) return await reject(c, { file: error.message });
    throw error;
  }
  return done(c, project.slug, "Design file added");
}

async function handleMapComponent(c: Context): Promise<Response> {
  const project = await adminProject(c);
  const form = await c.req.formData();
  const importPath = asString(form.get("importPath")) ?? "";
  if (!importPath) return await reject(c, { component: "Enter the story file path" });
  try {
    await designModel().setComponentLink(project.id, importPath, asString(form.get("url")) ?? "");
  } catch (error) {
    if (error instanceof InvalidDesignUrlError) {
      return await reject(c, { component: error.message });
    }
    throw error;
  }
  return done(c, project.slug, "Component mapped");
}

async function handleRemoveLink(c: Context): Promise<Response> {
  const project = await adminProject(c);
  await designModel().removeLink(project.id, c.req.param("id") ?? "");
  return done(c, project.slug, "Link removed");
}

async function handleSetToken(c: Context): Promise<Response> {
  const project = await adminProject(c);
  const provider = providerOf(c);
  const token = asString((await c.req.formData()).get("token"));
  if (!token) return await reject(c, { [`token:${provider.metadata.kind}`]: "Token is required" });
  await credentialModel().set(project.id, provider.metadata.kind, token);
  return done(c, project.slug, `${provider.metadata.name} token saved`);
}

async function handleRemoveToken(c: Context): Promise<Response> {
  const project = await adminProject(c);
  const provider = providerOf(c);
  await credentialModel().remove(project.id, provider.metadata.kind);
  return done(c, project.slug, `${provider.metadata.name} token removed`);
}
