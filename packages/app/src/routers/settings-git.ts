/**
 * Project → Settings → Git writes (ADR 0054, decisions 2 and 10): request, change and remove a
 * repository link, and the form pages that open in the dialog. All are `hosting` pages (git
 * delivery works with testing off) and project-admin only.
 */
import { cappedOutputs, isCommentMode, type StateOutputs } from "@storyshelf/core/adapter/notifier";
import { postsComments, requestRepositoryLink } from "@storyshelf/core/capture";
import {
  GitRepositoryLinkModel,
  connectionHost,
  GitRepositoryTakenError,
  SiteSettingsModel,
  type GitConnection,
} from "@storyshelf/core/models";
import type { GitRepositoryLinkRow, Project } from "@storyshelf/core/schema";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import {
  connectionFor,
  parseRepositoryUrl,
  prefixProblem,
  type ParsedRepository,
} from "../git-link-request.ts";
import { renderGitLinkFragment, renderGitLinkPage } from "../pages/git-link-form.tsx";
import type { GitLinkFormState, SettingsGitData } from "../pages/settings-git.tsx";
import { settingsHref } from "../pages/settings-tabs.ts";
import { getStore } from "../store.ts";
import { flash } from "./flash.ts";
import { notFound, resolveAuthorizedProject } from "./helpers.ts";
import { hxRedirect, isHxRequest } from "./htmx.ts";
import { loadGitSection, usableConnections } from "./settings-git-data.ts";
import { asString } from "./settings.handlers.ts";

/** Register the Git section's form pages and writes. */
export function registerGitSettings(app: ShelfRouter): void {
  app.get("/projects/:slug/settings/git/new", handleForm);
  app.get("/projects/:slug/settings/git/:linkId/edit", handleForm);
  app.post("/projects/:slug/settings/git", handleCreate);
  app.post("/projects/:slug/settings/git/:linkId", handleUpdate);
  app.post("/projects/:slug/settings/git/:linkId/delete", handleDelete);
}

/** The project and its Git data, or 404: without a connection the section does not exist. */
async function gitContext(c: Context): Promise<{ project: Project; data: SettingsGitData }> {
  const project = await resolveAuthorizedProject(c, c.req.param("slug") ?? "", "admin");
  const data = await loadGitSection(project);
  if (data === null) {
    notFound("Not found");
  }
  return { project, data };
}

/** One of the project's own links, or 404. */
async function ownLink(project: Project, id: string): Promise<GitRepositoryLinkRow> {
  const link = await new GitRepositoryLinkModel(getStore().db).get(id);
  if (link === null || link.projectId !== project.id) {
    notFound("Not found");
  }
  return link;
}

function formResponse(
  c: Context,
  ctx: { project: Project; data: SettingsGitData },
  linkId: string | undefined,
  state: GitLinkFormState | undefined,
  status: 200 | 400,
): Response | Promise<Response> {
  const link = ctx.data.links.find((candidate) => candidate.id === linkId);
  const props = { ...ctx, link, state };
  const body = isHxRequest(c) ? renderGitLinkFragment(props) : renderGitLinkPage(props);
  return c.html(body, status);
}

async function handleForm(c: Context): Promise<Response> {
  const ctx = await gitContext(c);
  const linkId = c.req.param("linkId");
  if (linkId !== undefined) {
    await ownLink(ctx.project, linkId);
  }
  return formResponse(c, ctx, linkId, undefined, 200);
}

type LinkRead =
  | { ok: true; repository: ParsedRepository; connection: GitConnection; prefix: string }
  | { ok: false; errors: Record<string, string>; values: { repository: string; prefix: string } };

/** The repository a typed URL names and the connection that owns its host, or null. */
function findRepository(
  typed: string,
  connections: readonly GitConnection[],
): { repository: ParsedRepository; connection: GitConnection } | null {
  const repository = parseRepositoryUrl(typed);
  // One answer for "not a URL", "no connection on that host" and "several hosts": the form never
  // says what the server can reach (decision 2).
  const connection = repository === null ? null : connectionFor(connections, repository);
  return repository !== null && connection !== null ? { repository, connection } : null;
}

function fieldErrors(noRepository: boolean, badPrefix: string | null): Record<string, string> {
  return {
    ...(noRepository
      ? { repository: "Enter the repository's URL on a host this server connects to." }
      : {}),
    ...(badPrefix === null ? {} : { prefix: badPrefix }),
  };
}

/** The repository and prefix typed into the form, or the field errors. */
function readForm(form: FormData, connections: readonly GitConnection[]): LinkRead {
  const typed = asString(form.get("repository")) ?? "";
  const prefix = asString(form.get("prefix")) ?? "";
  const found = findRepository(typed, connections);
  const problem = prefix.length === 0 ? null : prefixProblem(prefix);
  if (found !== null && problem === null) {
    return { ok: true, ...found, prefix };
  }
  return {
    ok: false,
    errors: fieldErrors(found === null, problem),
    values: { repository: typed, prefix },
  };
}

async function handleCreate(c: Context): Promise<Response> {
  const ctx = await gitContext(c);
  const read = readForm(await c.req.formData(), await usableConnections());
  if (!read.ok) {
    return formResponse(c, ctx, undefined, { errors: read.errors, values: read.values }, 400);
  }
  try {
    const link = await requestLink(ctx.project, read);
    flash(c, link.state === "approved" ? "Repository linked" : "Link requested");
  } catch (error) {
    return takenOrThrow(c, ctx, undefined, error, read.prefix);
  }
  return hxRedirect(c, settingsHref(ctx.project.slug, "git"));
}

/** Request the link; with the operator switch on and coverage confirmed it is approved at once. */
async function requestLink(
  project: Project,
  read: Extract<LinkRead, { ok: true }>,
): Promise<GitRepositoryLinkRow> {
  const store = getStore();
  const input = {
    projectId: project.id,
    connectionId: read.connection.id,
    host: connectionHost(read.connection.provider, read.connection.apiBase),
    owner: read.repository.owner,
    repo: read.repository.repo,
    prefix: read.prefix === "storyshelf" ? "" : read.prefix,
    requestedBy: store.user?.id,
  };
  if (store.buildState === undefined || store.gitConnections === undefined) {
    return await new GitRepositoryLinkModel(store.db).create(input);
  }
  return await requestRepositoryLink(
    {
      db: store.db,
      gitConnections: store.gitConnections,
      publisher: store.buildState,
      logger: store.logger,
      settings: new SiteSettingsModel(store.db),
    },
    input,
  );
}

/** A taken repository and prefix is a form error; anything else is a real failure. */
function takenOrThrow(
  c: Context,
  ctx: { project: Project; data: SettingsGitData },
  linkId: string | undefined,
  error: unknown,
  prefix: string,
): Response | Promise<Response> {
  if (!(error instanceof GitRepositoryTakenError)) {
    throw error;
  }
  const errors = {
    prefix: "That repository is already linked with this prefix. Choose another prefix.",
  };
  return formResponse(c, ctx, linkId, { errors, values: { prefix } }, 400);
}

/** The outputs the form chose, capped by what the connection may post. */
function outputsOf(form: FormData, connection: GitConnection | null): StateOutputs {
  const comment = asString(form.get("comment"));
  const chosen: StateOutputs = {
    storybook: form.get("storybook") !== null,
    comment: isCommentMode(comment) ? comment : "always",
    annotations: form.get("annotations") !== null,
  };
  return cappedOutputs(chosen, { pullRequests: connection ? postsComments(connection) : false });
}

async function handleUpdate(c: Context): Promise<Response> {
  const ctx = await gitContext(c);
  const link = await ownLink(ctx.project, c.req.param("linkId") ?? "");
  if (isManagedLink(ctx.data, link.id)) {
    return c.text("This link is managed by configuration.", 409);
  }
  return await saveLink(c, ctx, link);
}

async function saveLink(
  c: Context,
  ctx: { project: Project; data: SettingsGitData },
  link: GitRepositoryLinkRow,
): Promise<Response> {
  const form = await c.req.formData();
  const connections = await usableConnections();
  const read = readForm(form, connections);
  if (!read.ok) {
    return formResponse(c, ctx, link.id, { errors: read.errors, values: read.values }, 400);
  }
  try {
    await applyUpdate(link, read, form, connections);
  } catch (error) {
    return takenOrThrow(c, ctx, link.id, error, read.prefix);
  }
  flash(c, "Link saved");
  return hxRedirect(c, settingsHref(ctx.project.slug, "git"));
}

function isManagedLink(data: SettingsGitData, id: string): boolean {
  return data.links.find((candidate) => candidate.id === id)?.managed === true;
}

async function applyUpdate(
  link: GitRepositoryLinkRow,
  read: Extract<LinkRead, { ok: true }>,
  form: FormData,
  connections: readonly GitConnection[],
): Promise<void> {
  const links = new GitRepositoryLinkModel(getStore().db);
  const changed = await links.change(link.id, {
    connectionId: read.connection.id,
    host: connectionHost(read.connection.provider, read.connection.apiBase),
    owner: read.repository.owner,
    repo: read.repository.repo,
    prefix: read.prefix === "storyshelf" ? "" : read.prefix,
  });
  const connection = connections.find((candidate) => candidate.id === changed.connectionId);
  await links.setOutputs(link.id, outputsOf(form, connection ?? null));
}

async function handleDelete(c: Context): Promise<Response> {
  const { project, data } = await gitContext(c);
  const link = await ownLink(project, c.req.param("linkId") ?? "");
  if (isManagedLink(data, link.id)) {
    return c.text("This link is managed by configuration.", 409);
  }
  await new GitRepositoryLinkModel(getStore().db).remove(link.id);
  flash(c, "Link removed");
  return hxRedirect(c, settingsHref(project.slug, "git"));
}
