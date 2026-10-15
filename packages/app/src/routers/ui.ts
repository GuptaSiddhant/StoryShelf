import { BuildModel } from "@storyshelf/core/models";
import { CommentModel } from "@storyshelf/core/models";
import { LabelModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import { SnapshotModel } from "@storyshelf/core/models";
import type { ProjectRole } from "@storyshelf/core/types";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { loadInsightPanel } from "../insights/panel.ts";
import { renderBuildDetailPage } from "../pages/build-detail.tsx";
import type { LinkedUsageItem } from "../pages/build-diff-usage.tsx";
import { renderBuildDiffPage, selectedSnapshot } from "../pages/build-diff.tsx";
import {
  renderComponentPage,
  COMPONENT_TABS,
  type ComponentTab,
} from "../pages/component-detail.tsx";
import { renderComputeJobsPage, renderActiveQueue } from "../pages/compute-jobs.tsx";
import { renderLabelDetailPage, renderLabelsPage } from "../pages/label-detail.tsx";
import { renderLibraryPage } from "../pages/library.tsx";
import { renderProjectBuildsPage } from "../pages/project-builds.tsx";
import { renderProjectCreatePage } from "../pages/project-create.tsx";
import { renderProjectsPage } from "../pages/projects.tsx";
import { renderRootPage } from "../pages/root.tsx";
import { getStore } from "../store.ts";
import { loadBaselineView } from "./baseline-guard.ts";
import { loadComponentPage } from "./component.handlers.ts";
import {
  designUrlsFor,
  loadDesignResolutions,
  loadReviewDesign,
  returnPathOf,
} from "./design.handlers.ts";
import { flash } from "./flash.ts";
import { currentProjectRole } from "./helpers.ts";
import { hxRedirect } from "./htmx.ts";
import { linkedUsageByStory, linkedUsageFor } from "./links.handlers.ts";
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

interface QueueView {
  buildId: string;
  status: string;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

async function getQueueView(): Promise<QueueView[]> {
  const queue = getStore().captureQueue;
  if (!queue) {
    return [];
  }
  const active = await queue.active();
  return active.map((entry) => ({
    buildId: entry.buildId,
    status: entry.status,
    queuedAt: entry.queuedAt,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    error: entry.error,
  }));
}

async function canManageJobs(projectId: string): Promise<boolean> {
  const { authEnabled } = getStore();
  if (!authEnabled) {
    return true;
  }
  const roles: readonly ProjectRole[] = ["developer", "approver", "admin"];
  const role = await currentProjectRole(projectId);
  return Boolean(role && roles.includes(role));
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
      const message = error instanceof Error ? error.message : "Failed to create project";
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

  app.get("/projects/:slug/builds/:buildId", async (c) => {
    const buildId = c.req.param("buildId");
    const html = await renderBuildDetailPage(buildId, await loadBuildUsage(c, buildId));
    if (!html) {
      return c.notFound();
    }
    return c.html(html);
  });

  app.get("/projects/:slug/jobs", async (c) => {
    const slug = c.req.param("slug");
    const project = await new ProjectModel(getStore().db).getBySlug(slug);
    if (!project) {
      return c.notFound();
    }
    const queueView = await getQueueView();
    const canRetry = await canManageJobs(project.id);
    if (c.req.query("partial") === "queue") {
      return c.html(renderActiveQueue(slug, queueView));
    }
    const html = await renderComputeJobsPage(
      slug,
      queueView,
      canRetry,
      getStore().captureQueue?.metadata.kind === "memory",
    );
    if (!html) {
      return c.notFound();
    }
    return c.html(html);
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
        hasBaseline,
        drifted,
        insight: await loadInsightPanel(project, build),
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
    const value = c.req.path.startsWith(base) ? decodeRest(c.req.path.slice(base.length)) : "";
    const html = await renderLabelDetailPage(slug, key, value);
    if (!html) {
      return c.notFound();
    }
    return c.html(html);
  });

  app.get("/projects/:slug/components/*", async (c) => {
    const slug = c.req.param("slug");
    const base = `/projects/${slug}/components/`;
    const path = c.req.path.startsWith(base) ? decodeRest(c.req.path.slice(base.length)) : "";
    const tab = COMPONENT_TABS.find((candidate) => candidate === c.req.query("tab")) ?? "states";
    const data = await loadComponentPage(c, slug, path, tab satisfies ComponentTab);
    return data ? c.html(renderComponentPage(data)) : c.notFound();
  });

  app.get("/projects/:slug/library", async (c) => {
    const html = await renderLibraryPage(c.req.param("slug"), c.req.query("branch"));
    if (!html) {
      return c.notFound();
    }
    return c.html(html);
  });

  registerSettingsPages(app);
}

/** Linked-package usage for every story of a build; empty on any failure so the page still renders. */
async function loadBuildUsage(
  c: Context,
  buildId: string,
): Promise<Map<string, LinkedUsageItem[]>> {
  try {
    const build = await new BuildModel(getStore().db).get(buildId);
    const project = build ? await new ProjectModel(getStore().db).get(build.projectId) : null;
    return build && project ? await linkedUsageByStory(c, project, build.id) : new Map();
  } catch {
    return new Map();
  }
}
