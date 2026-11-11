import { isCaptureTarget, type CaptureTarget } from "@storyshelf/core/adapter/capture-runner";
import { resolveBrowsers } from "@storyshelf/core/capture";
import { ProjectModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import { storybookUrlTtlOverrideError } from "@storyshelf/core/utils";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { settingsHref } from "../pages/settings-tabs.ts";
import { getStore } from "../store.ts";
import { assertTargetsSelectable } from "../targets.ts";
import { toProjectPatch } from "./capture-config.ts";
import { flash } from "./flash.ts";
import { hxRedirect } from "./htmx.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";

/** Capture settings: browsers (primary + extras), the mode allowlist and the signed URL lifetime. */
export function registerCaptureSettings(app: ShelfRouter): void {
  app.post("/projects/:slug/settings/capture", handleCaptureUpdate);
  app.post("/projects/:slug/settings/thresholds", handleThresholdsUpdate);
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

/** Seconds of the signed Storybook URL lifetime; empty derives it from the stories (null). */
function readUrlTtl(form: FormData): number | null {
  const raw = asString(form.get("storybookUrlTtlSeconds"));
  if (!raw) return null;
  const seconds = Number(raw);
  const message = storybookUrlTtlOverrideError(seconds);
  if (message !== undefined) {
    throw new HTTPException(400, { message });
  }
  return seconds;
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
    storybookUrlTtlSeconds: readUrlTtl(form),
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
  return hxRedirect(c, settingsHref(project.slug, "capture"));
}

/** A fraction from 0 to 1, or undefined when the field is blank or not in range. */
function fractionOf(raw: string | undefined): number | undefined | null {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/** Diff thresholds: how different two captures may be before a snapshot counts as changed. */
async function handleThresholdsUpdate(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  const form = await c.req.formData();
  const pixelThreshold = fractionOf(asString(form.get("pixelThreshold")));
  const maxDiffRatio = fractionOf(asString(form.get("maxDiffRatio")));
  if (pixelThreshold === null || maxDiffRatio === null) {
    return c.html(
      (await renderSettingsPage(c, "thresholds", {
        globalError: "Both thresholds must be numbers from 0 to 1",
      })) ?? "",
      400,
    );
  }
  await new ProjectModel(getStore().db).update(project.id, { pixelThreshold, maxDiffRatio });
  flash(c, "Thresholds saved");
  return hxRedirect(c, settingsHref(project.slug, "thresholds"));
}
