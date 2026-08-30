import type { Context } from "hono";
import type { ShelfApp } from "../index.tsx";

import { LabelModel } from "../models/label.ts";
import { MemberModel } from "../models/member.ts";
import { ProjectModel } from "../models/project.ts";
import { TokenModel } from "../models/token.ts";
import { WebhookModel } from "../models/webhook.ts";
import { renderProjectSettingsPage, type SettingsFormState, type SettingsTab } from "../pages/project-settings.tsx";
import type { SettingsMember } from "../pages/settings-members.tsx";
import type { SettingsWebhook } from "../pages/settings-webhooks.tsx";
import type { LabelType, Project, Token } from "../schema.ts";
import { getStore } from "../store.ts";
import { randomToken } from "../utils/hash.ts";
import { notFound } from "./helpers.ts";
import { hxRedirect } from "./htmx.ts";

interface SettingsData {
  project: Project;
  labelTypes: LabelType[];
  tokens: Array<Omit<Token, "hash">>;
  members: SettingsMember[];
  webhooks: SettingsWebhook[];
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
  const webhooksDb = await new WebhookModel(db).list(project.id);
  const webhooks = webhooksDb.map((webhook) => ({ id: webhook.id, url: webhook.url, events: WebhookModel.eventsOf(webhook) }));
  const { user, authEnabled } = getStore();
  const isAdmin = !authEnabled || user?.role === "admin" || members.some((member) => member.userId === user?.id && member.role === "admin");
  return { project, labelTypes, tokens, members, webhooks, isAdmin };
}

export async function renderSettingsPage(c: Context, tab: SettingsTab, formState?: SettingsFormState): Promise<string> {
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
      webhooks: data.webhooks,
      isAdmin: data.isAdmin,
    },
    formState,
  );
}

async function settingsPage(c: Context, tab: SettingsTab): Promise<string> {
  const html = await renderSettingsPage(c, tab);
  if (!html) {
    notFound("Project not found");
  }
  return html;
}

async function findProject(slug: string): Promise<Project> {
  const project = await new ProjectModel(getStore().db).getBySlug(slug);
  if (!project) {
    notFound("Project not found");
  }
  return project;
}

export function registerSettingsPages(app: ShelfApp): void {
  app.get("/projects/:slug/settings", async (c) => c.html(await settingsPage(c, "general")));
  app.get("/projects/:slug/settings/labels", async (c) => c.html(await settingsPage(c, "labels")));
  app.get("/projects/:slug/settings/tokens", async (c) => c.html(await settingsPage(c, "tokens")));
  app.get("/projects/:slug/settings/webhooks", async (c) => c.html(await settingsPage(c, "webhooks")));
  app.get("/projects/:slug/settings/members", async (c) => c.html(await settingsPage(c, "members")));

  app.post("/projects/:slug/settings", async (c) => {
    const slug = c.req.param("slug");
    const project = await findProject(slug);
    const form = await c.req.formData();
    const name = form.get("name");
    if (typeof name !== "string" || name.trim() === "") {
      return c.html((await renderSettingsPage(c, "general", { errors: { name: "Name is required" } })) ?? "", 400);
    }
    const gitRepository = asString(form.get("gitRepository"));
    const gitDefaultBranch = asString(form.get("gitDefaultBranch"));
    const pixelThreshold = asString(form.get("pixelThreshold"));
    const maxDiffRatio = asString(form.get("maxDiffRatio"));
    const publicBranchRegex = asString(form.get("publicBranchRegex"));
    try {
      await new ProjectModel(getStore().db).update(project.id, {
        name: name.trim(),
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
    const project = await findProject(c.req.param("slug"));
    await new ProjectModel(getStore().db).remove(project.id);
    return hxRedirect(c, "/projects");
  });

  app.post("/projects/:slug/settings/labels", async (c) => {
    const project = await findProject(c.req.param("slug"));
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
    const project = await findProject(c.req.param("slug"));
    try {
      await new LabelModel(getStore().db).removeType(project.id, c.req.param("key"));
    } catch {
      return c.html((await renderSettingsPage(c, "labels", { globalError: "Cannot delete built-in label" })) ?? "", 400);
    }
    return hxRedirect(c, `/projects/${project.slug}/settings/labels`);
  });

  app.post("/projects/:slug/settings/tokens", async (c) => {
    const project = await findProject(c.req.param("slug"));
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
    const project = await findProject(c.req.param("slug"));
    await new TokenModel(getStore().db).remove(c.req.param("tokenId"));
    return hxRedirect(c, `/projects/${project.slug}/settings/tokens`);
  });

  app.post("/projects/:slug/settings/webhooks", async (c) => {
    const project = await findProject(c.req.param("slug"));
    const form = await c.req.formData();
    const url = asString(form.get("url"));
    if (!url) {
      return c.html((await renderSettingsPage(c, "webhooks", { errors: { url: "A valid URL is required" } })) ?? "", 400);
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return c.html((await renderSettingsPage(c, "webhooks", { errors: { url: "Enter a valid URL" } })) ?? "", 400);
    }
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      return c.html((await renderSettingsPage(c, "webhooks", { errors: { url: "URL must use http or https" } })) ?? "", 400);
    }
    const eventsRaw = asString(form.get("events"));
    const events = eventsRaw ? eventsRaw.split(",").map((event) => event.trim()).filter((event) => event.length > 0) : undefined;
    const webhookModel = new WebhookModel(getStore().db);
    const secret = randomToken("whsec_").value;
    await webhookModel.create(project.id, { url, events, secret });
    return c.html((await renderSettingsPage(c, "webhooks", { secret })) ?? "", 201);
  });

  app.post("/projects/:slug/settings/webhooks/:webhookId/delete", async (c) => {
    const project = await findProject(c.req.param("slug"));
    const webhook = await new WebhookModel(getStore().db).get(project.id, c.req.param("webhookId"));
    if (!webhook) {
      notFound("Webhook not found");
    }
    await new WebhookModel(getStore().db).remove(project.id, webhook.id);
    return hxRedirect(c, `/projects/${project.slug}/settings/webhooks`);
  });

  app.post("/projects/:slug/settings/members", async (c) => {
    const project = await findProject(c.req.param("slug"));
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
    const project = await findProject(c.req.param("slug"));
    await new MemberModel(getStore().db).remove(project.id, c.req.param("userId"));
    return hxRedirect(c, `/projects/${project.slug}/settings/members`);
  });
}

function asString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}