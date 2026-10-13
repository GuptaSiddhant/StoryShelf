import { BROWSER_NAMES, type BrowserName } from "@storyshelf/core/adapter/capture-runner";
import { MAX_BROWSERS } from "@storyshelf/core/capture";
import { ProjectModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
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

function isBrowser(value: string): value is BrowserName {
  return (BROWSER_NAMES as readonly string[]).includes(value);
}

/** Primary engine first, then the ticked extras; null when the form is malformed. */
function readBrowsers(form: FormData): BrowserName[] | string {
  const primary = asString(form.get("browser")) ?? "chromium";
  if (!isBrowser(primary)) return `Unknown browser "${primary}"`;
  const extras = BROWSER_NAMES.filter((name) => form.get(`extra_${name}`) === name);
  const all = [primary, ...extras];
  const unique = [...new Set(all)] as BrowserName[];
  return unique.length > MAX_BROWSERS ? `Choose at most ${MAX_BROWSERS} browsers` : unique;
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
  browsers: BrowserName[],
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
  const browsers = readBrowsers(form);
  if (typeof browsers === "string") return await reject(c, browsers);
  try {
    await saveCapture(project, form, browsers);
  } catch (error) {
    if (error instanceof HTTPException) return await reject(c, error.message);
    throw error;
  }
  flash(c, "Capture settings saved");
  return hxRedirect(c, `/projects/${project.slug}/settings/capture`);
}
