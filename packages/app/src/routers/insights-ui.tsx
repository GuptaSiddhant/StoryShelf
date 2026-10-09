import type { ShelfRouter } from "../app-types.ts";
import { HEALTH_UI_WINDOW, loadHealthPanel } from "../insights/health-panel.ts";
import { loadInsightPanel } from "../insights/panel.ts";
import { requestHealth, requestTriage } from "../insights/request.ts";
import { InsightPanel } from "../pages/build-diff-insight.tsx";
import { HealthPanel } from "../pages/health-panel.tsx";
import { buildForProject } from "./builds.handlers.ts";
import { notFound } from "./helpers.ts";
import { projectForRegenerate, projectForView } from "./insights.handlers.ts";

/** Register the HTMX fragments for the project health panel. */
function registerHealthFragments(app: ShelfRouter): void {
  app.get("/projects/:slug/insights/health/panel", async (c) => {
    const { project } = await projectForView(c, c.req.param("slug"));
    const data = await loadHealthPanel(project);
    return data ? c.html(<HealthPanel project={project} data={data} />) : notFound();
  });

  app.post("/projects/:slug/insights/health/generate", async (c) => {
    const { deps, project } = await projectForRegenerate(c, c.req.param("slug"));
    const form = await c.req.formData();
    await requestHealth(deps, project, HEALTH_UI_WINDOW, { force: form.get("force") === "true" });
    const data = await loadHealthPanel(project);
    return data ? c.html(<HealthPanel project={project} data={data} />) : notFound();
  });
}

/** Register the HTMX fragments for the build-review AI triage panel. */
export function registerInsightFragments(app: ShelfRouter): void {
  registerHealthFragments(app);
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
