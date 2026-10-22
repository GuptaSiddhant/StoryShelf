/** Create a git (`state`) channel from the settings form: repository, status prefix and token. */
import { NotificationChannelModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { Context } from "hono";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { notificationChannelModel } from "./scoped-models.ts";
import { asString, renderSettingsPage } from "./settings.handlers.ts";

const CONFIG_FIELDS = ["owner", "repo", "host", "prefix"] as const;

/** The provider config from the form; blank optional fields are left out. */
function gitConfig(form: FormData): Record<string, string> {
  const config: Record<string, string> = {};
  for (const field of CONFIG_FIELDS) {
    const value = asString(form.get(field));
    if (value) {
      config[field] = value;
    }
  }
  return config;
}

/** Render the tab again with field errors (HTTP 400). */
async function formError(c: Context, errors: Record<string, string>): Promise<Response> {
  return c.html((await renderSettingsPage(c, "notifications", { errors })) ?? "", 400);
}

/** Map a failed validation to the form fields it concerns. */
function fieldErrors(
  checked: Extract<ReturnType<typeof NotificationChannelModel.validateInput>, { ok: false }>,
): Record<string, string> {
  if (checked.field === "secret") {
    return { token: checked.message };
  }
  if (checked.field === "provider") {
    return { gitProvider: checked.message };
  }
  const errors: Record<string, string> = {};
  for (const issue of checked.issues ?? []) {
    errors[issue.path] ??= issue.message;
  }
  return Object.keys(errors).length > 0 ? errors : { gitProvider: checked.message };
}

/** Validate and store a git channel; the token lands in the encrypted secret column. */
export async function createGitChannel(
  c: Context,
  project: Project,
  provider: string,
  form: FormData,
): Promise<Response> {
  const config = gitConfig(form);
  const token = asString(form.get("token"));
  const problem = gitChannelProblem(project, provider, config, token);
  if (problem) {
    return await formError(c, problem);
  }
  await notificationChannelModel().create({
    projectId: project.id,
    provider,
    config,
    secret: token,
  });
  flash(c, "Git channel added");
  return c.html((await renderSettingsPage(c, "notifications")) ?? "", 201);
}

/** The form errors for a git channel input, or null when it is valid. */
function gitChannelProblem(
  project: Project,
  provider: string,
  config: Record<string, string>,
  token: string | undefined,
): Record<string, string> | null {
  const { notifiers } = getStore();
  if (!NotificationChannelModel.isStateKind(notifiers, provider)) {
    return { gitProvider: `Unknown git provider: ${provider}` };
  }
  const checked = NotificationChannelModel.validateInput(notifiers, provider, config, {
    projectId: project.id,
    hasSecret: Boolean(token),
  });
  return checked.ok ? null : fieldErrors(checked);
}
