/**
 * The per-project git channels that remain (ADR 0054, decision 8), as System › Git lists them for a
 * move and as the System page and the project's settings warn about them. A view holds the
 * channel's repository and the connections that can take it over, never its token or key.
 */
import {
  connectionFits,
  listPerProjectGitChannels,
  ProjectModel,
  type GitConnection,
  type PerProjectGitChannel,
} from "@storyshelf/core/models";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { GitChannelView } from "./pages/admin-git-channels.tsx";
import { getStore } from "./store.ts";

const KIND_LABELS = {
  "github-app": "GitHub App",
  "github-token": "GitHub token",
  "gitlab-token": "GitLab token",
} as const;

/** Every remaining channel with the server's `connections` that can take it over. */
export async function loadGitChannelViews(
  connections: readonly GitConnection[],
): Promise<GitChannelView[]> {
  const { db } = getStore();
  const channels = await listPerProjectGitChannels(db);
  if (channels.length === 0) {
    return [];
  }
  const projects = await new ProjectModel(db).list();
  return channels.map((channel) => channelView(channel, connections, projects));
}

/** How many channels remain on the whole server (the System page warns about them). */
export async function gitChannelCount(): Promise<number> {
  return (await listPerProjectGitChannels(getStore().db)).length;
}

/** The view of one channel; exported for the move dialog. */
export function channelView(
  channel: PerProjectGitChannel,
  connections: readonly GitConnection[],
  projects: readonly { id: string; name: string; slug: string }[],
): GitChannelView {
  const project = projects.find((candidate) => candidate.id === channel.projectId);
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  const fitting = connections.filter((connection) => connectionFits(channel, connection));
  return {
    id: channel.id,
    kind: channel.kind,
    kindLabel: KIND_LABELS[channel.kind],
    repository: `${channel.owner}/${channel.repo}`,
    host: channel.host,
    prefix: channel.prefix,
    enabled: channel.enabled,
    updatedAt: channel.updatedAt,
    project: project
      ? { name: project.name, href: urls.settingsTab(project.slug, "notifications") }
      : null,
    connections: fitting.map((connection) => ({ id: connection.id, name: connection.name })),
    canCreate: canCreateFrom(channel, fitting),
  };
}

/** A GitHub App channel becomes a connection, unless a fitting one is that App already. */
function canCreateFrom(channel: PerProjectGitChannel, fitting: readonly GitConnection[]): boolean {
  return (
    channel.kind === "github-app" &&
    channel.appId !== null &&
    !fitting.some((connection) => String(connection.config["appId"]) === channel.appId)
  );
}
