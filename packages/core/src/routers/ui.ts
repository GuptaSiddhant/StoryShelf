import type { OpenAPIHono } from "@hono/zod-openapi";

import { BaselineModel } from "../models/baseline.ts";
import { BuildModel } from "../models/build.ts";
import { CommentModel } from "../models/comment.ts";
import { LabelModel } from "../models/label.ts";
import { ProjectModel } from "../models/project.ts";
import { SnapshotModel } from "../models/snapshot.ts";
import { renderBuildDetailPage } from "../pages/build-detail.tsx";
import { renderBuildDiffPage } from "../pages/build-diff.tsx";
import { renderComputeJobsPage, renderActiveQueue } from "../pages/compute-jobs.tsx";
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

interface QueueView {
  buildId: string;
  status: string;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

function getQueueView(): QueueView[] {
  const queue = getStore().captureQueue;
  if (!queue) {
    return [];
  }
  return queue.active().map((entry) => ({
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

export function registerUiPages(app: OpenAPIHono): void {
  // eslint-disable-next-line promise-function-async -- renderRootPage returns RenderedContent (string | Promise<string>)
  app.get("/", (c) => c.html(renderRootPage()));
  app.get("/projects", async (c) => c.html(await renderProjectsPage()));
  // eslint-disable-next-line promise-function-async -- renderProjectCreatePage returns RenderedContent (string | Promise<string>)
  app.get("/projects/new", (c) => c.html(renderProjectCreatePage()));

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
    const queueView = getQueueView();
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

  registerSettingsPages(app);
}