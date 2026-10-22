import { isCaptureTarget, type CaptureTarget } from "@storyshelf/core/adapter/capture-runner";
import { resolveBrowsers } from "@storyshelf/core/capture";
import { ProjectModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { assertTargetsSelectable } from "../targets.ts";
import { toProjectPatch } from "./capture-config.ts";
import { flash } from "./flash.ts";
import { hxRedirect } from "./htmx.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";

/** Capture settings: browsers (primary + extras) and the mode allowlist. */
export function registerCaptureSettings(app: ShelfRouter): void {
  app.get("/projects/:slug/settings/capture", async (c) =>
    c.html(await renderSettingsPage(c, "capture")),
  );
  app.post("/projects/:slug/settings/capture", handleCaptureUpdate);
}

const EXTRA_PREFIX = "extra_";

/** Primary target first, then the ticked extras; throws 400 when the form is malformed. */
function readBrowsers(form: FormData): CaptureTarget[] {
  const primary = asString(form.get("browser")) ?? "chromium";
  if (!isCaptureTarget(primary)) throw badBrowser(primary);
  const extras = [...form.entries()].flatMap(([key, value]) =>
    key.startsWith(EXTRA_PREFIX) && value === key.slice(EXTRA_PREFIX.length)
      ? [key.slice(EXTRA_PREFIX.length)]
      : [],
  );
  const bad = extras.find((extra) => !isCaptureTarget(extra));
  if (bad !== undefined) throw badBrowser(bad);
  return [...new Set([primary, ...(extras as CaptureTarget[])])];
}

function badBrowser(value: string): HTTPException {
  return new HTTPException(400, { message: `Unknown browser "${value}"` });
}

/** Mode names, one per line (blank lines and surrounding space ignored). */
function readAllowlist(form: FormData): string[] | null {
  const lines = (asString(form.get("modesAllowlist")) ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.length > 0 ? lines : null;
}

async function reject(c: Context, message: string): Promise<Response> {
  return c.html((await renderSettingsPage(c, "capture", { globalError: message })) ?? "", 400);
}

async function saveCapture(
  project: Project,
  form: FormData,
  browsers: CaptureTarget[],
): Promise<void> {
  const patch = toProjectPatch({
    browsers: browsers.length > 1 ? browsers : null,
    browser: browsers[0],
    modesAllowlist: readAllowlist(form),
  });
  await new ProjectModel(getStore().db).update(project.id, patch);
}

async function handleCaptureUpdate(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const form = await c.req.formData();
  try {
    const browsers = readBrowsers(form);
    await assertTargetsSelectable(browsers, resolveBrowsers(project));
    await saveCapture(project, form, browsers);
  } catch (error) {
    if (error instanceof HTTPException) return await reject(c, error.message);
    throw error;
  }
  flash(c, "Capture settings saved");
  return hxRedirect(c, `/projects/${project.slug}/settings/capture`);
}
