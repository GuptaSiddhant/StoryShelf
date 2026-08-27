import type { Context, Hono } from "hono";

import { BuildModel } from "../models/build.ts";
import { CommentModel } from "../models/comment.ts";
import { LabelModel } from "../models/label.ts";
import { MemberModel } from "../models/member.ts";
import { ProjectModel } from "../models/project.ts";
import { SnapshotModel } from "../models/snapshot.ts";
import { TokenModel } from "../models/token.ts";
import { renderBuildDetailPage } from "../pages/build-detail.tsx";
import { renderBuildDiffPage } from "../pages/build-diff.tsx";
import { renderProjectCreatePage } from "../pages/project-create.tsx";
import { renderProjectBuildsPage } from "../pages/project-builds.tsx";
import { renderProjectsPage } from "../pages/projects.tsx";
import { renderProjectSettingsPage, type SettingsTab } from "../pages/project-settings.tsx";
import { renderRootPage } from "../pages/root.tsx";
import type { SettingsMember } from "../pages/settings-members.tsx";
import type { LabelType, Project, Token } from "../schema.ts";
import { getStore } from "../store.ts";
import { randomToken } from "../utils/hash.ts";
import { notFound } from "./helpers.ts";

async function settingsPage(c: Context, tab: SettingsTab): Promise<string> {
  const html = await renderSettingsPage(c, tab);
  if (!html) {
    notFound("Project not found");
  }
  return html;
}

function isHxRequest(c: Context): boolean {
  return c.req.header("HX-Request") === "true";
}

function hxRedirect(c: Context, url: string): Response {
  if (isHxRequest(c)) {
    c.header("HX-Redirect", url);
    return c.body(null, 204);
  }
  return c.redirect(url, 302);
}

function asString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

interface SettingsData {
  project: Project;
  labelTypes: LabelType[];
  tokens: Array<Omit<Token, "hash">>;
  members: SettingsMember[];
  isAdmin: boolean;
}

async function loadSettingsData(slug: string): Promise<SettingsData | null> {
  const project = await new ProjectModel(getStore().db).getBySlug(slug);
  if (!project) {
    return null;
  }
  const db = getStore().db;
  const labelTypes = await new LabelModel(db).listTypes(project.id);
  const tokensDb = await new TokenModel(db).list(project.id);
  const tokens = tokensDb.map(({ hash: _hash, ...rest }) => rest);
  const members = await new MemberModel(db).list(project.id);
  const { user, authEnabled } = getStore();
const isAdmin = !authEnabled || user?.role === "admin" || members.some((member) => member.userId === user?.id && member.role === "admin");
  return { project, labelTypes, tokens, members, isAdmin };
}

async function renderSettingsPage(c: Context, tab: SettingsTab, formState?: { errors?: Record<string, string>; globalError?: string }): Promise<string> {
  const slug = c.req.param("slug") ?? "";
  const data = await loadSettingsData(slug);
  if (!data) {
    notFound("Project not found");
  }
  return await renderProjectSettingsPage(
    {
      project: data.project,
      activeTab: tab,
      labelTypes: data.labelTypes,
      tokens: data.tokens,
      members: data.members,
      isAdmin: data.isAdmin,
    },
    formState,
  );
}

export function registerUiPages(app: Hono): void {
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
      }),
    );
  });

  app.get("/projects/:slug/settings", async (c) => c.html(await settingsPage(c, "general")));
  app.get("/projects/:slug/settings/labels", async (c) => c.html(await settingsPage(c, "labels")));
  app.get("/projects/:slug/settings/tokens", async (c) => c.html(await settingsPage(c, "tokens")));
  app.get("/projects/:slug/settings/members", async (c) => c.html(await settingsPage(c, "members")));

  app.post("/projects/:slug/settings", async (c) => {
    const slug = c.req.param("slug");
    const project = await new ProjectModel(getStore().db).getBySlug(slug);
    if (!project) {
      return c.notFound();
    }
    const form = await c.req.formData();
    const name = asString(form.get("name"));
    if (!name) {
      return c.html((await renderSettingsPage(c, "general", { errors: { name: "Name is required" } })) ?? "", 400);
    }
    const gitRepository = asString(form.get("gitRepository"));
    const gitDefaultBranch = asString(form.get("gitDefaultBranch"));
    const pixelThreshold = asString(form.get("pixelThreshold"));
    const maxDiffRatio = asString(form.get("maxDiffRatio"));
    const publicBranchRegex = asString(form.get("publicBranchRegex"));
    try {
      await new ProjectModel(getStore().db).update(project.id, {
        name,
        gitRepository: gitRepository ?? undefined,
        gitDefaultBranch: gitDefaultBranch ?? undefined,
        pixelThreshold: pixelThreshold ? Number(pixelThreshold) : undefined,
        maxDiffRatio: maxDiffRatio ? Number(maxDiffRatio) : undefined,
        publicBranchRegex: publicBranchRegex === "" ? null : (publicBranchRegex ?? undefined),
      });
      return hxRedirect(c, `/projects/${slug}/settings`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update";
      return c.html((await renderSettingsPage(c, "general", { globalError: message })) ?? "", 400);
    }
  });

  app.post("/projects/:slug/delete", async (c) => {
    const project = await new ProjectModel(getStore().db).getBySlug(c.req.param("slug"));
    if (!project) {
      return c.notFound();
    }
    await new ProjectModel(getStore().db).remove(project.id);
    return hxRedirect(c, "/projects");
  });

  app.post("/projects/:slug/settings/labels", async (c) => {
    const project = await new ProjectModel(getStore().db).getBySlug(c.req.param("slug"));
    if (!project) {
      return c.notFound();
    }
    const form = await c.req.formData();
    const key = asString(form.get("key"));
    const labelName = asString(form.get("labelName")) ?? asString(form.get("name"));
    const linkTemplate = asString(form.get("linkTemplate"));
    if (!key || !labelName) {
      return c.html((await renderSettingsPage(c, "labels", { globalError: "Key and name are required" })) ?? "", 400);
    }
    try {
      await new LabelModel(getStore().db).createType(project.id, { key, name: labelName, linkTemplate });
      return hxRedirect(c, `/projects/${project.slug}/settings/labels`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create label";
      return c.html((await renderSettingsPage(c, "labels", { globalError: message })) ?? "", 400);
    }
  });

  app.post("/projects/:slug/settings/labels/:key/delete", async (c) => {
    const project = await new ProjectModel(getStore().db).getBySlug(c.req.param("slug"));
    if (!project) {
      return c.notFound();
    }
    try {
      await new LabelModel(getStore().db).removeType(project.id, c.req.param("key"));
    } catch {
      return c.html((await renderSettingsPage(c, "labels", { globalError: "Cannot delete built-in label" })) ?? "", 400);
    }
    return hxRedirect(c, `/projects/${project.slug}/settings/labels`);
  });

  app.post("/projects/:slug/settings/tokens", async (c) => {
    const project = await new ProjectModel(getStore().db).getBySlug(c.req.param("slug"));
    if (!project) {
      return c.notFound();
    }
    const form = await c.req.formData();
    const tokenName = asString(form.get("tokenName")) ?? asString(form.get("name"));
    if (!tokenName) {
      return c.html((await renderSettingsPage(c, "tokens", { globalError: "Name is required" })) ?? "", 400);
    }
    const token = randomToken("shelf_");
    await new TokenModel(getStore().db).create(project.id, tokenName, token.hash);
    const html = await renderSettingsPage(c, "tokens");
    const inject = `<div class="alert alert--success" role="alert"><strong class="alert__title">Token created</strong><div class="alert__body">Copy now — shown once: <code>${token.value}</code></div></div>`;
    const withToken = html.replace('<nav class="tabs"', `${inject}<nav class="tabs"`);
    return c.html(withToken);
  });

  app.post("/projects/:slug/settings/tokens/:tokenId/delete", async (c) => {
    const project = await new ProjectModel(getStore().db).getBySlug(c.req.param("slug"));
    if (!project) {
      return c.notFound();
    }
    await new TokenModel(getStore().db).remove(c.req.param("tokenId"));
    return hxRedirect(c, `/projects/${project.slug}/settings/tokens`);
  });

  app.post("/projects/:slug/settings/members", async (c) => {
    const project = await new ProjectModel(getStore().db).getBySlug(c.req.param("slug"));
    if (!project) {
      return c.notFound();
    }
    const form = await c.req.formData();
    const userId = asString(form.get("userId"));
    const role = asString(form.get("role"));
    if (!userId || !role) {
      return c.html((await renderSettingsPage(c, "members", { globalError: "User and role are required" })) ?? "", 400);
    }
    await new MemberModel(getStore().db).set(project.id, userId, role as never);
    return hxRedirect(c, `/projects/${project.slug}/settings/members`);
  });

  app.post("/projects/:slug/settings/members/:userId/remove", async (c) => {
    const project = await new ProjectModel(getStore().db).getBySlug(c.req.param("slug"));
    if (!project) {
      return c.notFound();
    }
    await new MemberModel(getStore().db).remove(project.id, c.req.param("userId"));
    return hxRedirect(c, `/projects/${project.slug}/settings/members`);
  });
}