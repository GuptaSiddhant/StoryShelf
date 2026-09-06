import type { Context } from "hono";
import type { ShelfApp } from "../index.tsx";
import { ProjectModel } from "../models/project.ts";
import type { Project } from "../schema/project.ts";
import { getStore } from "../store.ts";
import { hxRedirect } from "./htmx.ts";
import { asString, findProject, renderSettingsPage } from "./settings.handlers.ts";

/** General project settings (name, repo, thresholds) and danger-zone delete. */
export function registerGeneralSettings(app: ShelfApp): void {
  app.get("/projects/:slug/settings", async (c) => c.html(await renderSettingsPage(c, "general")));
  app.get("/projects/:slug/settings/tests", async (c) =>
    c.html(await renderSettingsPage(c, "tests")),
  );
  app.post("/projects/:slug/settings", handleGeneralUpdate);
  app.post("/projects/:slug/settings/tests", handleTestsUpdate);
  app.post("/projects/:slug/delete", handleDeleteProject);
}

interface GeneralFields {
  name: string;
  gitRepository?: string;
  gitDefaultBranch?: string;
  pixelThreshold?: string;
  maxDiffRatio?: string;
  publicBranchRegex?: string;
}

/** Read the general-settings form fields (name validated by the caller). */
function readGeneralFields(form: FormData): Omit<GeneralFields, "name"> {
  return {
    gitRepository: asString(form.get("gitRepository")),
    gitDefaultBranch: asString(form.get("gitDefaultBranch")),
    pixelThreshold: asString(form.get("pixelThreshold")),
    maxDiffRatio: asString(form.get("maxDiffRatio")),
    publicBranchRegex: asString(form.get("publicBranchRegex")),
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

async function persistGeneralUpdate(
  c: Context,
  project: Project,
  slug: string,
  fields: GeneralFields,
): Promise<Response> {
  try {
    await new ProjectModel(getStore().db).update(project.id, {
      name: fields.name,
      gitRepository: fields.gitRepository ?? undefined,
      gitDefaultBranch: fields.gitDefaultBranch ?? undefined,
      pixelThreshold: fields.pixelThreshold ? Number(fields.pixelThreshold) : undefined,
      maxDiffRatio: fields.maxDiffRatio ? Number(fields.maxDiffRatio) : undefined,
      publicBranchRegex:
        fields.publicBranchRegex === "" ? null : (fields.publicBranchRegex ?? undefined),
    });
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
    return c.html(
      (await renderSettingsPage(c, "tests", { globalError: rangeError })) ?? "",
      400,
    );
  }
  return await persistTestsUpdate(c, project, slug, executePlay, playTimeoutMs);
}

/** Read the tests-tab form fields. */
function readTestsFields(form: FormData): { executePlay: boolean; playTimeoutMs: number | undefined } {
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
    return hxRedirect(c, `/projects/${slug}/settings/tests`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update";
    return c.html((await renderSettingsPage(c, "tests", { globalError: message })) ?? "", 400);
  }
}

async function handleDeleteProject(c: Context): Promise<Response> {
  const project = await findProject(c.req.param("slug") ?? "");
  await new ProjectModel(getStore().db).remove(project.id);
  return hxRedirect(c, "/projects");
}
