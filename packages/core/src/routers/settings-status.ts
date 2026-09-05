import type { Context } from "hono";
import type { ShelfApp } from "../index.tsx";
import type { GitHostProvider } from "../adapters/git-host/index.ts";
import { StatusConfigModel } from "../models/status-config.ts";
import type { Project } from "../schema/project.ts";
import { getStore } from "../store.ts";
import { hxRedirect } from "./htmx.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";

/** Merge-gate status-config settings (provider configs + tokens, delete). */
export function registerStatusSettings(app: ShelfApp): void {
  app.get("/projects/:slug/settings/status", async (c) =>
    c.html(await renderSettingsPage(c, "status")),
  );
  app.post("/projects/:slug/settings/status", handleCreateStatus);
  app.post("/projects/:slug/settings/status/:id/delete", handleDeleteStatus);
}

async function unknownProviderResponse(c: Context): Promise<Response> {
  return c.html(
    (await renderSettingsPage(c, "status", { globalError: "Unknown git provider" })) ?? "",
    400,
  );
}

async function missingTokenResponse(c: Context): Promise<Response> {
  return c.html(
    (await renderSettingsPage(c, "status", { errors: { token: "Token is required" } })) ?? "",
    400,
  );
}

interface StatusFields {
  project: Project;
  provider: GitHostProvider;
  token: string;
  configRaw: string;
}

async function readStatusFields(c: Context): Promise<StatusFields | Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const form = await c.req.formData();
  const provider = getStore().gitHosts.find((p) => p.metadata.kind === asString(form.get("provider")));
  if (!provider) {
    return await unknownProviderResponse(c);
  }
  const token = asString(form.get("token"));
  if (!token) {
    return await missingTokenResponse(c);
  }
  return { project, provider, token, configRaw: asString(form.get("config")) ?? "{}" };
}

async function handleCreateStatus(c: Context): Promise<Response> {
  const fields = await readStatusFields(c);
  if (fields instanceof Response) {
    return fields;
  }
  return await createStatusFromForm(c, fields.project, fields.provider, fields.token, fields.configRaw);
}

async function createStatusFromForm(
  c: Context,
  project: Project,
  provider: GitHostProvider,
  token: string,
  configRaw: string,
): Promise<Response> {
  const config = parseJsonConfig(configRaw);
  if (config === undefined) {
    return c.html(
      (await renderSettingsPage(c, "status", {
        errors: { config: "Config must be valid JSON" },
      })) ?? "",
      400,
    );
  }
  const parsed = provider.metadata.schema.safeParse(config);
  if (!parsed.success) {
    return c.html(
      (await renderSettingsPage(c, "status", { errors: { config: parsed.error.message } })) ?? "",
      400,
    );
  }
  return await persistStatusConfig(c, project, provider, token, parsed.data);
}

async function persistStatusConfig(
  c: Context,
  project: Project,
  provider: GitHostProvider,
  token: string,
  config: unknown,
): Promise<Response> {
  const { db, config: shelfConfig } = getStore();
  await new StatusConfigModel(db, shelfConfig.secret).create(project.id, {
    provider: provider.metadata.kind,
    config,
    token,
  });
  return hxRedirect(c, `/projects/${project.slug}/settings/status`);
}

/** Parse the provider config JSON, or undefined when invalid. */
function parseJsonConfig(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

async function handleDeleteStatus(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const { db, config: shelfConfig } = getStore();
  await new StatusConfigModel(db, shelfConfig.secret).remove(project.id, c.req.param("id") ?? "");
  return hxRedirect(c, `/projects/${project.slug}/settings/status`);
}
