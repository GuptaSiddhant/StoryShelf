import { InvalidDesignUrlError, type DesignProvider } from "@storyshelf/core/adapter/design";
import { DesignCredentialModel, DesignModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { credentialKeys } from "../credential-keys.ts";
import {
  AddDesignFileForm,
  DesignTokenForm,
  MapComponentForm,
} from "../pages/design-forms.tsx";
import { settingsHref } from "../pages/settings-tabs.ts";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { notFound, resolveAuthorizedProject } from "./helpers.ts";
import { respondWithForm } from "./form-response.tsx";
import { hxRedirect } from "./htmx.ts";
import { asString } from "./settings.handlers.ts";

/** Design settings (project design files, component mapping, provider credentials). */
export function registerDesignSettings(app: ShelfRouter): void {
  const base = "/projects/:slug/settings/design";
  app.get(`${base}/files/new`, async (c) => await linkForm(c, "file"));
  app.get(`${base}/components/new`, async (c) => await linkForm(c, "component"));
  app.get(`${base}/:provider/token/edit`, async (c) => await tokenForm(c));
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

/** What the add forms show under their URL field: the providers' own URL hints. */
function urlHint(): string {
  return getStore()
    .design.map((provider) => provider.metadata.urlHint)
    .join(" or ");
}

/** The add-file or map-component form, empty or with the refusal that sent it back. */
async function linkForm(
  c: Context,
  which: "file" | "component",
  error?: string,
  status: 200 | 400 = 200,
): Promise<Response> {
  const project = await adminProject(c);
  const file = which === "file";
  return respondWithForm(
    c,
    project,
    "capture",
    file ? "Add design file" : "Map component",
    (standalone) =>
      file ? (
        <AddDesignFileForm project={project} standalone={standalone} urlHint={urlHint()} error={error} />
      ) : (
        <MapComponentForm project={project} standalone={standalone} urlHint={urlHint()} error={error} />
      ),
    status,
  );
}

/** The set-or-rotate token form of one provider. */
async function tokenForm(c: Context, error?: string, status: 200 | 400 = 200): Promise<Response> {
  const project = await adminProject(c);
  const provider = providerOf(c);
  const { metadata } = provider;
  const replace = (await credentialModel().info(project.id, metadata.kind)) !== null;
  return respondWithForm(
    c,
    project,
    "capture",
    `${metadata.name} token`,
    (standalone) => (
      <DesignTokenForm
        project={project}
        provider={{
          kind: metadata.kind,
          name: metadata.name,
          credentialLabel: metadata.credentialLabel,
          ...(metadata.credentialPlaceholder ? { placeholder: metadata.credentialPlaceholder } : {}),
        }}
        replace={replace}
        standalone={standalone}
        error={error}
      />
    ),
    status,
  );
}

function done(c: Context, slug: string, message: string): Response {
  flash(c, message);
  return hxRedirect(c, settingsHref(slug, "design"));
}

async function handleAddFile(c: Context): Promise<Response> {
  const project = await adminProject(c);
  const form = await c.req.formData();
  const label = asString(form.get("label")) ?? "";
  try {
    await designModel().addProjectLink(project.id, { label, url: asString(form.get("url")) ?? "" });
  } catch (error) {
    if (error instanceof InvalidDesignUrlError) return await linkForm(c, "file", error.message, 400);
    throw error;
  }
  return done(c, project.slug, "Design file added");
}

async function handleMapComponent(c: Context): Promise<Response> {
  const project = await adminProject(c);
  const form = await c.req.formData();
  const importPath = asString(form.get("importPath")) ?? "";
  if (!importPath) return await linkForm(c, "component", "Enter the story file path", 400);
  try {
    await designModel().setComponentLink(project.id, importPath, asString(form.get("url")) ?? "");
  } catch (error) {
    if (error instanceof InvalidDesignUrlError) {
      return await linkForm(c, "component", error.message, 400);
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
  if (!token) return await tokenForm(c, "Token is required", 400);
  await credentialModel().set(project.id, provider.metadata.kind, token);
  return done(c, project.slug, `${provider.metadata.name} token saved`);
}

async function handleRemoveToken(c: Context): Promise<Response> {
  const project = await adminProject(c);
  const provider = providerOf(c);
  await credentialModel().remove(project.id, provider.metadata.kind);
  return done(c, project.slug, `${provider.metadata.name} token removed`);
}
