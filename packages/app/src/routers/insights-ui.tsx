import type { ShelfRouter } from "../app-types.ts";
import { loadInsightPanel } from "../insights/panel.ts";
import { requestTriage } from "../insights/request.ts";
import { InsightPanel } from "../pages/build-diff-insight.tsx";
import { buildForProject } from "./builds.handlers.ts";
import { notFound } from "./helpers.ts";
import { projectForRegenerate, projectForView } from "./insights.handlers.ts";

/** Register the HTMX fragments for the build-review AI triage panel. */
export function registerInsightFragments(app: ShelfRouter): void {
  app.get("/projects/:slug/builds/:buildId/insights/panel", async (c) => {
    const { project } = await projectForView(c, c.req.param("slug"));
    const build = await buildForProject(project.id, c.req.param("buildId"));
    const data = await loadInsightPanel(project, build);
    return data ? c.html(<InsightPanel project={project} build={build} data={data} />) : notFound();
  });

  app.post("/projects/:slug/builds/:buildId/insights/generate", async (c) => {
    const { deps, project } = await projectForRegenerate(c, c.req.param("slug"));
    const build = await buildForProject(project.id, c.req.param("buildId"));
    const form = await c.req.formData();
    await requestTriage(deps, project, build, { force: form.get("force") === "true" });
    const data = await loadInsightPanel(project, build);
    return data ? c.html(<InsightPanel project={project} build={build} data={data} />) : notFound();
  });
}
