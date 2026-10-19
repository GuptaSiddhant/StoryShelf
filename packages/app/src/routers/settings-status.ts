import { StatusConfigModel, type StatusConfigValidation } from "@storyshelf/core/models";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { hxRedirect } from "./htmx.ts";
import { statusConfigModel } from "./scoped-models.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";
/** Merge-gate status-config settings (provider configs + tokens, delete). */
export function registerStatusSettings(app: ShelfRouter): void {
  app.get("/projects/:slug/settings/status", async (c) =>
    c.html(await renderSettingsPage(c, "status")),
  );
  app.post("/projects/:slug/settings/status", handleCreateStatus);
  app.post("/projects/:slug/settings/status/:id/delete", handleDeleteStatus);
}

async function statusError(
  c: Context,
  errors: Record<string, string>,
  globalError?: string,
): Promise<Response> {
  return c.html((await renderSettingsPage(c, "status", { errors, globalError })) ?? "", 400);
}

interface StatusInput {
  provider: string;
  config: unknown;
  token: string;
}

/** First problem with the status form, in field order (provider, token, JSON, schema). */
function statusFormProblem(
  token: string | undefined,
  config: unknown,
  checked: StatusConfigValidation,
): { errors: Record<string, string>; globalError?: string } | null {
  if (!checked.ok && checked.field === "provider") {
    return { errors: {}, globalError: "Unknown git provider" };
  }
  if (!token) {
    return { errors: { token: "Token is required" } };
  }
  if (config === undefined) {
    return { errors: { config: "Config must be valid JSON" } };
  }
  return checked.ok ? null : { errors: { config: checked.message } };
}

/** Validate the status form; returns the input or the error response. */
async function readStatusInput(c: Context, form: FormData): Promise<StatusInput | Response> {
  const token = asString(form.get("token"));
  const config = parseJsonConfig(asString(form.get("config")) ?? "{}");
  const provider = asString(form.get("provider"));
  const checked = StatusConfigModel.validateInput(getStore().gitHosts, provider, config);
  const problem = statusFormProblem(token, config, checked);
  if (problem || !checked.ok || !token) {
    return await statusError(c, problem?.errors ?? {}, problem?.globalError);
  }
  return { provider: checked.provider.metadata.kind, config: checked.config, token };
}

async function handleCreateStatus(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const input = await readStatusInput(c, await c.req.formData());
  if (input instanceof Response) {
    return input;
  }
  await statusConfigModel().create(project.id, input);
  flash(c, "Git status config added");
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
  await statusConfigModel().remove(project.id, c.req.param("id") ?? "");
  flash(c, "Git status config removed");
  return hxRedirect(c, `/projects/${project.slug}/settings/status`);
}
