/**
 * What System → Git shows (ADR 0054): each connection with its health, coverage and ceiling, and the
 * links waiting for a site admin. Every view is built from a `GitConnection`, which has no secret;
 * a secret is read only to probe health, and never leaves this module.
 */
import { gitConnectionHealth, type GitConnectionHealth } from "@storyshelf/core/integrations";
import {
  anyRepositoryLinkAllowed,
  GIT_CHANNELS_STOP_RELEASE,
  GitConnectionModel,
  GitRepositoryLinkModel,
  ProjectModel,
  SiteSettingsModel,
  type GitConnection,
} from "@storyshelf/core/models";
import type { GitRepositoryLinkRow } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import { credentialKeys } from "./credential-keys.ts";
import { loadGitChannelViews } from "./git-channels-admin.ts";
import { notificationOrigin } from "./notifications-pause.ts";
import type {
  AdminGitData,
  GitConnectionView,
  GitHealthState,
  GitLinkRequestView,
} from "./pages/admin-git.tsx";
import { getStore, type Store } from "./store.ts";

/** A health probe's bound, so a slow host never holds the page. */
const PROBE_TIMEOUT_MS = 3000;

/** The server's connections: the wired model, or one over the store's database. */
export function gitConnectionModel(store: Store = getStore()): GitConnectionModel {
  return store.gitConnections ?? new GitConnectionModel(store.db, credentialKeys(store.config));
}

/** The confirmed public origin (configured, platform or confirmed by an admin), or null. */
export async function confirmedOrigin(store: Store = getStore()): Promise<string | null> {
  return (await notificationOrigin(store)) ?? null;
}

/** Everything the page shows. */
export async function loadAdminGitData(): Promise<AdminGitData> {
  const store = getStore();
  const connections = await gitConnectionModel(store).list();
  const links = await new GitRepositoryLinkModel(store.db).listAll();
  return {
    connections: await Promise.all(
      connections.map(async (connection) => await connectionView(connection, links)),
    ),
    requests: await requestViews(links, connections),
    anyRepository: await anyRepositoryLinkAllowed(new SiteSettingsModel(store.db)),
    origin: await confirmedOrigin(store),
    channels: await loadGitChannelViews(connections),
    stopRelease: GIT_CHANNELS_STOP_RELEASE,
  };
}

async function connectionView(
  connection: GitConnection,
  links: readonly GitRepositoryLinkRow[],
): Promise<GitConnectionView> {
  const expiresOn = connection.config["expiresOn"];
  return {
    id: connection.id,
    name: connection.name,
    providerLabel: connection.provider === "github-app" ? "GitHub App" : "GitLab token",
    account: accountOf(connection),
    posts: postsOf(connection),
    linked: links.filter((link) => link.connectionId === connection.id && link.state === "approved")
      .length,
    health: connection.ignored
      ? { state: "unknown", detail: "Not probed" }
      : await probe(connection),
    expiresOn: typeof expiresOn === "string" ? expiresOn : undefined,
    managed: connection.managed,
    ignored: connection.ignored,
    installUrl: installUrlOf(connection),
  };
}

/** Who owns the App or which group the token is for, and where its host is. */
export function accountOf(
  connection: Pick<GitConnection, "provider" | "apiBase" | "config">,
): string {
  const text = (key: string): string => {
    const value = connection.config[key];
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  };
  const host = connection.apiBase ? new URL(connection.apiBase).host : "";
  if (connection.provider === "github-app") {
    const owner = text("owner") || `App ${text("appId")}`;
    return host ? `${owner} on ${host}` : owner;
  }
  const group = text("group");
  return group ? `${group} on ${host || "gitlab.com"}` : host || "gitlab.com";
}

/** What a connection may post: the gate always, the comment and plain statuses when allowed. */
export function postsOf(connection: Pick<GitConnection, "provider" | "config">): string[] {
  const raw = connection.config["posts"];
  const posts = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const github = connection.provider === "github-app";
  return [
    github ? "check runs" : "commit statuses",
    ...(posts["pullRequests"] === false
      ? []
      : [github ? "pull-request comment" : "merge-request comment"]),
    ...(github && posts["statuses"] === true ? ["commit statuses"] : []),
  ];
}

/** A GitHub App's installation page, when the App's page is known (it came from the manifest flow). */
export function installUrlOf(connection: GitConnection): string | undefined {
  const url = connection.config["htmlUrl"];
  return connection.provider === "github-app" &&
    typeof url === "string" &&
    url.startsWith("https://")
    ? `${url.replace(/\/+$/u, "")}/installations/new`
    : undefined;
}

/** One free read with the connection's own secret; the detail names a status, never the secret. */
async function probe(
  connection: GitConnection,
): Promise<{ state: GitHealthState; detail: string }> {
  try {
    const secret = await gitConnectionModel().secretOf(connection.id);
    return secret === null
      ? { state: "failed", detail: "No stored secret" }
      : healthView(
          await gitConnectionHealth(connection, secret, {
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          }),
        );
  } catch (error) {
    // A secret that no configured SHELF_SECRET decrypts lands here; the System page names those.
    getStore().logger.warn(
      { connectionId: connection.id, reason: errorName(error) },
      "git connection probe failed",
    );
    return { state: "unknown", detail: "Could not be checked" };
  }
}

function healthView(health: GitConnectionHealth): { state: GitHealthState; detail: string } {
  if (!health.ok) {
    return { state: "failed", detail: health.detail ?? "Unreachable" };
  }
  return health.warning
    ? { state: "warning", detail: health.warning }
    : { state: "ok", detail: health.detail ?? "Reachable" };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

/** Pending links, then broken ones, with their project and connection. */
async function requestViews(
  links: readonly GitRepositoryLinkRow[],
  connections: readonly GitConnection[],
): Promise<GitLinkRequestView[]> {
  const open = links.filter((link) => link.state === "pending" || link.state === "broken");
  const projects = await new ProjectModel(getStore().db).list();
  return open
    .toSorted((a, b) => (a.state === b.state ? 0 : a.state === "pending" ? -1 : 1))
    .map((link) => linkView(link, projects, connections));
}

/** The view of one link (for the list and the dialogs). */
export function linkView(
  link: GitRepositoryLinkRow,
  projects: readonly { id: string; name: string; slug: string }[],
  connections: readonly Pick<GitConnection, "id" | "name">[],
): GitLinkRequestView {
  const project = projects.find((candidate) => candidate.id === link.projectId);
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  return {
    id: link.id,
    state: link.state === "broken" ? "broken" : "pending",
    repository: `${link.owner}/${link.repo}`,
    prefix: link.prefix,
    project: project
      ? { name: project.name, href: urls.settingsTab(project.slug, "review") }
      : null,
    connectionName:
      connections.find((connection) => connection.id === link.connectionId)?.name ??
      "a removed connection",
    reason: link.reason,
    requestedAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}
