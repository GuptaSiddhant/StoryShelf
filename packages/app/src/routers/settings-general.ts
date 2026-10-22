import { resolveBrowsers } from "@storyshelf/core/capture";
import { ProjectModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { assertTargetsSelectable } from "../targets.ts";
import { flash } from "./flash.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { hxRedirect } from "./htmx.ts";
import { runSwitchOffPass } from "./review-switch-off.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";
/** General project settings (name, repo, thresholds) and danger-zone delete. */
export function registerGeneralSettings(app: ShelfRouter): void {
  app.get("/projects/:slug/settings", async (c) => c.html(await renderSettingsPage(c, "general")));
  app.get("/projects/:slug/settings/tests", async (c) =>
    c.html(await renderSettingsPage(c, "tests")),
  );
  app.post("/projects/:slug/settings", handleGeneralUpdate);
  app.post("/projects/:slug/settings/tests", handleTestsUpdate);
  app.post("/projects/:slug/settings/review", handleReviewUpdate);
  app.post("/projects/:slug/delete", handleDeleteProject);
}

interface GeneralFields {
  name: string;
  gitRepository?: string;
  gitDefaultBranch?: string;
  pixelThreshold?: string;
  maxDiffRatio?: string;
  publicBranchRegex?: string;
  browser?: string;
}

/** Read the general-settings form fields (name validated by the caller). */
function readGeneralFields(form: FormData): Omit<GeneralFields, "name"> {
  return {
    gitRepository: asString(form.get("gitRepository")),
    gitDefaultBranch: asString(form.get("gitDefaultBranch")),
    pixelThreshold: asString(form.get("pixelThreshold")),
    maxDiffRatio: asString(form.get("maxDiffRatio")),
    publicBranchRegex: asString(form.get("publicBranchRegex")),
    browser: asString(form.get("browser")),
  };
}

async function handleGeneralUpdate(c: Context): Promise<Response> {
  const slug = c.req.param("slug") ?? "";
  const project = await findProject(slug);
  const form = await c.req.formData();
  const name = form.get("name");
  if (typeof name !== "string" || name.trim() === "") {
    return c.html(
      (await renderSettingsPage(c, "general", { errors: { name: "Name is required" } })) ?? "",
      400,
    );
  }
  const fields: GeneralFields = { ...readGeneralFields(form), name: name.trim() };
  return await persistGeneralUpdate(c, project, slug, fields);
}

/** Refuse, with 400 and the reason, a browser the runner cannot render (ADR 0007, decision 7). */
async function assertBrowserChoice(project: Project, browser: string | undefined): Promise<void> {
  if (browser !== undefined) {
    await assertTargetsSelectable([browser], resolveBrowsers(project));
  }
}

async function persistGeneralUpdate(
  c: Context,
  project: Project,
  slug: string,
  fields: GeneralFields,
): Promise<Response> {
  try {
    await assertBrowserChoice(project, fields.browser);
    await new ProjectModel(getStore().db).update(project.id, {
      name: fields.name,
      gitRepository: fields.gitRepository ?? undefined,
      gitDefaultBranch: fields.gitDefaultBranch ?? undefined,
      pixelThreshold: fields.pixelThreshold ? Number(fields.pixelThreshold) : undefined,
      maxDiffRatio: fields.maxDiffRatio ? Number(fields.maxDiffRatio) : undefined,
      publicBranchRegex:
        fields.publicBranchRegex === "" ? null : (fields.publicBranchRegex ?? undefined),
      browser: fields.browser ?? undefined,
      // Picking a different single engine returns the project to one-browser capture.
      ...(fields.browser && fields.browser !== project.browser ? { browsers: null } : {}),
    });
    flash(c, "Project settings saved");
    return hxRedirect(c, `/projects/${slug}/settings`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update";
    return c.html((await renderSettingsPage(c, "general", { globalError: message })) ?? "", 400);
  }
}

async function handleTestsUpdate(c: Context): Promise<Response> {
  const slug = c.req.param("slug") ?? "";
  const project = await findProject(slug);
  const form = await c.req.formData();
  const { executePlay, playTimeoutMs } = readTestsFields(form);
  const rangeError = playTimeoutError(playTimeoutMs);
  if (rangeError) {
    return c.html((await renderSettingsPage(c, "tests", { globalError: rangeError })) ?? "", 400);
  }
  return await persistTestsUpdate(c, project, slug, executePlay, playTimeoutMs);
}

/** Read the tests-tab form fields. */
function readTestsFields(form: FormData): {
  executePlay: boolean;
  playTimeoutMs: number | undefined;
} {
  const playTimeoutMsRaw = asString(form.get("playTimeoutMs"));
  return {
    executePlay: form.get("executePlay") === "true",
    playTimeoutMs: playTimeoutMsRaw ? Number(playTimeoutMsRaw) : undefined,
  };
}

/** Range error for the play timeout, or null when valid. */
function playTimeoutError(playTimeoutMs: number | undefined): string | null {
  if (
    playTimeoutMs !== undefined &&
    (Number.isNaN(playTimeoutMs) || playTimeoutMs < 1000 || playTimeoutMs > 30_000)
  ) {
    return "Play timeout must be between 1000 and 30000";
  }
  return null;
}

async function persistTestsUpdate(
  c: Context,
  project: Project,
  slug: string,
  executePlay: boolean,
  playTimeoutMs: number | undefined,
): Promise<Response> {
  try {
    await new ProjectModel(getStore().db).update(project.id, {
      executePlay,
      playTimeoutMs: playTimeoutMs ?? undefined,
    });
    flash(c, "Test settings saved");
    return hxRedirect(c, `/projects/${slug}/settings/tests`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update";
    return c.html((await renderSettingsPage(c, "tests", { globalError: message })) ?? "", 400);
  }
}

async function handleDeleteProject(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  await new ProjectModel(getStore().db).remove(project.id);
  flash(c, `Deleted ${project.name}`);
  return hxRedirect(c, "/projects");
}

/** Largest approval count the form and the API accept. */
const MAX_APPROVALS = 20;

/**
 * Review settings (ADR 0013, decision 1): the switch and the approvals a build needs. Project
 * admins only. The route is classed `hosting`, not `review`: a review route answers 404 while
 * review is off, and this is the form that turns it back on. Turning review off accepts the
 * project's pending builds that no capture worked on, in one pass.
 */
async function handleReviewUpdate(c: Context): Promise<Response> {
  const slug = c.req.param("slug") ?? "";
  const project = await resolveAuthorizedProject(c, slug, "admin");
  const form = await c.req.formData();
  const approvals = approvalsOf(form, project);
  if (approvals === null) {
    return c.html(
      (await renderSettingsPage(c, "general", {
        errors: { reviewApprovals: `Enter a whole number from 1 to ${MAX_APPROVALS}` },
      })) ?? "",
      400,
    );
  }
  const updated = await new ProjectModel(getStore().db).update(project.id, {
    reviewEnabled: form.get("reviewEnabled") === "true",
    reviewApprovals: approvals,
  });
  const accepted = await runSwitchOffPass(project, updated);
  flash(c, reviewSavedMessage(accepted));
  return hxRedirect(c, `/projects/${slug}/settings`);
}

/** The approvals count of the form (the current one when blank); null when it is not 1 to 20. */
function approvalsOf(form: FormData, project: Project): number | null {
  const raw = asString(form.get("reviewApprovals"));
  const approvals = raw ? Number(raw) : (project.reviewApprovals ?? 1);
  return Number.isInteger(approvals) && approvals >= 1 && approvals <= MAX_APPROVALS
    ? approvals
    : null;
}

function reviewSavedMessage(accepted: number): string {
  return accepted > 0
    ? `Review settings saved; accepted ${accepted} pending build${accepted === 1 ? "" : "s"}`
    : "Review settings saved";
}
