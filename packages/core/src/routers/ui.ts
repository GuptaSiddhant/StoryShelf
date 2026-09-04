import type { ShelfApp } from "../index.tsx";

import { BaselineModel } from "../models/baseline.ts";
import { BuildModel } from "../models/build.ts";
import { CommentModel } from "../models/comment.ts";
import { LabelModel } from "../models/label.ts";
import { ProjectModel } from "../models/project.ts";
import { SnapshotModel } from "../models/snapshot.ts";
import { renderBuildDetailPage } from "../pages/build-detail.tsx";
import { renderBuildDiffPage } from "../pages/build-diff.tsx";
import { renderComputeJobsPage, renderActiveQueue } from "../pages/compute-jobs.tsx";
import { renderLabelDetailPage, renderLabelsPage } from "../pages/label-detail.tsx";
import { renderProjectCreatePage } from "../pages/project-create.tsx";
import { renderProjectBuildsPage } from "../pages/project-builds.tsx";
import { renderProjectsPage } from "../pages/projects.tsx";
import { renderRootPage } from "../pages/root.tsx";
import { getStore } from "../store.ts";
import type { ProjectRole } from "../types.ts";
import { currentProjectRole } from "./helpers.ts";
import { hxRedirect } from "./htmx.ts";
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
export function registerUiPages(app: ShelfApp): void {
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
      return c.html(renderProjectCreatePage({ values: { name, gitRepository, gitDefaultBranch }, errors: { name: "Name is required" } }), 400);
    }
    try {
      const project = await new ProjectModel(getStore().db).create({ name, gitRepository, gitDefaultBranch });
      await new LabelModel(getStore().db).seedFor(project.id);
      return hxRedirect(c, `/projects/${project.slug}/builds`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create project";
      return c.html(renderProjectCreatePage({ values: { name, gitRepository, gitDefaultBranch }, globalError: message }), 400);
    }
  });

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
    const html = await renderBuildDetailPage(c.req.param("buildId"));
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
    const html = await renderComputeJobsPage(slug, queueView, canRetry);
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
    const baselines = new BaselineModel(getStore().db, getStore().storage);
    const hasBaselineEntries = await Promise.all(
      snapshots.map(async (snapshot) => {
        const baseline = await baselines.resolve(project.id, snapshot.storyId, snapshot.viewportName, build.gitBranch, project.gitDefaultBranch);
        return [snapshot.id, Boolean(baseline)] as const;
      }),
    );
    const hasBaseline = Object.fromEntries(hasBaselineEntries);
    const { user, authEnabled } = getStore();
    const canReview = !authEnabled || Boolean(user);
    return c.html(
      renderBuildDiffPage({
        project,
        build,
        snapshots,
        comments,
        selectedId: snapshotId,
        canReview,
        hasBaseline,
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

  registerSettingsPages(app);
}