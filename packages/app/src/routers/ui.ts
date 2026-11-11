import { BuildModel } from "@storyshelf/core/models";
import { CommentModel } from "@storyshelf/core/models";
import { LabelModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import { SnapshotModel } from "@storyshelf/core/models";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { ShelfRouter } from "../app-types.ts";
import { loadInsightPanel } from "../insights/panel.ts";
import { loadBuildDetails } from "../pages/build-detail.tsx";
import { renderBuildDiffPage, selectedSnapshot } from "../pages/build-diff.tsx";
import { renderComponentPage } from "../pages/component-detail.tsx";
import { renderActiveQueue } from "../pages/compute-jobs.tsx";
import { renderLabelDetailPage, renderLabelsPage } from "../pages/label-detail.tsx";
import { renderLibraryPage } from "../pages/library.tsx";
import { renderProjectBuildsPage } from "../pages/project-builds.tsx";
import { renderProjectCreatePage } from "../pages/project-create.tsx";
import { renderProjectsPage } from "../pages/projects.tsx";
import { renderRootPage } from "../pages/root.tsx";
import { getStore } from "../store.ts";
import { loadBaselineView } from "./baseline-guard.ts";
import { loadBaselineReference, loadDefaultComparison } from "./baseline-reference.ts";
import { isBuildAuthor } from "./comment-triage.ts";
import { loadComponentPage } from "./component.handlers.ts";
import { registerDesignCoverage } from "./design-coverage.ts";
import {
  designUrlsFor,
  loadDesignResolutions,
  loadReviewDesign,
  returnPathOf,
} from "./design.handlers.ts";
import { flash } from "./flash.ts";
import { publicMessage } from "./helpers.ts";
import { hxRedirect } from "./htmx.ts";
import { linkedUsageFor } from "./links.handlers.ts";
import { namesOf, reviewCapabilities } from "./review-section.handlers.ts";
import { getQueueView } from "./settings-insights.ts";
import { registerSettingsPages } from "./settings.ts";
function asString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function decodeRest(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

/** Register the server-rendered HTML pages (projects, builds, diffs, labels, settings). */
export function registerUiPages(app: ShelfRouter): void {
  // eslint-disable-next-line promise-function-async -- renderRootPage returns RenderedContent (string | Promise<string>)
  app.get("/", async (c) => c.html(await renderRootPage()));
  app.get("/projects", async (c) => c.html(await renderProjectsPage()));
  // eslint-disable-next-line promise-function-async -- renderProjectCreatePage returns RenderedContent (string | Promise<string>)
  app.get("/projects/new", async (c) => c.html(await renderProjectCreatePage()));

  app.post("/projects/new", async (c) => {
    const form = await c.req.formData();
    const name = asString(form.get("name"));
    const gitRepository = asString(form.get("gitRepository"));
    const gitDefaultBranch = asString(form.get("gitDefaultBranch"));
    if (!name) {
      return c.html(
        renderProjectCreatePage({
          values: { name, gitRepository, gitDefaultBranch },
          errors: { name: "Name is required" },
        }),
        400,
      );
    }
    try {
      const project = await new ProjectModel(getStore().db).create({
        name,
        gitRepository,
        gitDefaultBranch,
      });
      await new LabelModel(getStore().db).seedFor(project.id);
      flash(c, `Created ${project.name}`);
      return hxRedirect(c, `/projects/${project.slug}/library`);
    } catch (error) {
      const message = publicMessage(error, "Failed to create project");
      return c.html(
        renderProjectCreatePage({
          values: { name, gitRepository, gitDefaultBranch },
          globalError: message,
        }),
        400,
      );
    }
  });

  app.get("/projects/:slug", (c) => c.redirect(`/projects/${c.req.param("slug")}/library`, 302));

  app.get("/projects/:slug/builds", async (c) => {
    const html = await renderProjectBuildsPage(c.req.param("slug"), {
      status: c.req.query("status"),
      branch: c.req.query("branch"),
    });
    if (!html) {
      return c.notFound();
    }
    return c.html(html);
  });

  // The overview is gone: a build has one page, the review stage (keeps the query string).
  app.get("/projects/:slug/builds/:buildId", (c) => {
    const query = new URL(c.req.url).search;
    return c.redirect(
      `/projects/${c.req.param("slug")}/builds/${c.req.param("buildId")}/diff${query}`,
      302,
    );
  });

  // Jobs moved to the project's Insights tab; the queue card still refreshes itself from here.
  app.get("/projects/:slug/jobs", async (c) => {
    const slug = c.req.param("slug");
    const project = await new ProjectModel(getStore().db).getBySlug(slug);
    if (!project) {
      return c.notFound();
    }
    if (c.req.query("partial") === "queue") {
      return c.html(renderActiveQueue(slug, await getQueueView()));
    }
    return c.redirect(createUrlBuilder("/").settingsTab(slug, "insights"), 302);
  });

  app.get("/projects/:slug/builds/:buildId/diff", async (c) => {
    const slug = c.req.param("slug");
    const buildId = c.req.param("buildId");
    const snapshotId = c.req.query("snapshot");
    const project = await new ProjectModel(getStore().db).getBySlug(slug);
    if (!project) {
      return c.notFound();
    }
    const build = await new BuildModel(getStore().db).get(buildId);
    if (!build || build.projectId !== project.id) {
      return c.notFound();
    }
    const snapshots = await new SnapshotModel(getStore().db).listByBuild(build.id);
    const comments = await new CommentModel(getStore().db).listByBuild(build.id);
    const { hasBaseline, drifted } = await loadBaselineView(project, build, snapshots);
    const { user, authEnabled } = getStore();
    const canReview = !authEnabled || Boolean(user);
    const canManage = (await reviewCapabilities(project)).canComment;
    const canTriage = canManage || isBuildAuthor(build);
    const selected = selectedSnapshot(snapshots, snapshotId);
    const design = selected
      ? await loadReviewDesign(
          project,
          selected,
          designUrlsFor(await loadDesignResolutions(project, snapshots), selected),
          returnPathOf(c),
        ).catch(() => [])
      : [];
    return c.html(
      renderBuildDiffPage({
        project,
        build,
        snapshots,
        comments,
        selectedId: snapshotId,
        canReview,
        canTriage,
        canManage,
        names: await namesOf(comments.flatMap((item) => [item.userId, item.resolvedBy])),
        hasBaseline,
        drifted,
        reference: selected ? await loadBaselineReference(project, build, selected) : undefined,
        defaultComparison: selected ? await loadDefaultComparison(project, build, selected) : null,
        insight: await loadInsightPanel(project, build),
        details: await loadBuildDetails(project, build),
        design,
        usage: await linkedUsageFor(
          c,
          project,
          build.id,
          selectedSnapshot(snapshots, snapshotId)?.storyImportPath ?? null,
        ).catch(() => []),
        publishedBaseDomain: getStore().config.publishedBaseDomain,
      }),
    );
  });

  app.get("/projects/:slug/labels", async (c) => {
    const html = await renderLabelsPage(c.req.param("slug"));
    if (!html) {
      return c.notFound();
    }
    return c.html(html);
  });

  app.get("/projects/:slug/labels/:key/*", async (c) => {
    const slug = c.req.param("slug");
    const key = c.req.param("key");
    // Hono's bare `/*` wildcard is not exposed through `param()`, so derive the
    // label value from the raw request path and decode it ourselves.
    const base = `/projects/${slug}/labels/${key}/`;
    // A value with a `.` or `..` segment cannot travel in the path: it comes as `?value=`.
    const value =
      c.req.query("value") ??
      (c.req.path.startsWith(base) ? decodeRest(c.req.path.slice(base.length)) : "");
    const html = await renderLabelDetailPage(slug, key, value);
    if (!html) {
      return c.notFound();
    }
    return c.html(html);
  });

  app.get("/projects/:slug/components/*", async (c) => {
    const slug = c.req.param("slug");
    const base = `/projects/${slug}/components/`;
    // An import path with a `.` or `..` segment (`../ui/Button`) comes as `?path=`.
    const path =
      c.req.query("path") ??
      (c.req.path.startsWith(base) ? decodeRest(c.req.path.slice(base.length)) : "");
    const data = await loadComponentPage(
      c,
      slug,
      path,
      c.req.query("tab"),
      c.req.query("story"),
      c.req.query("build"),
    );
    return data ? c.html(renderComponentPage(data)) : c.notFound();
  });

  app.get("/projects/:slug/library", async (c) => {
    const html = await renderLibraryPage(c.req.param("slug"), c.req.query("branch"));
    if (!html) {
      return c.notFound();
    }
    return c.html(html);
  });

  registerDesignCoverage(app);
  registerSettingsPages(app);
}
