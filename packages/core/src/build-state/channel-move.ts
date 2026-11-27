/**
 * Moving a per-project git channel to an approved repository link (ADR 0054, decision 8): a site
 * admin picks a connection (or, for a GitHub App channel, makes one from the channel's own App),
 * the connection's coverage of the repository is checked and pinned as an approval would, and the
 * channel becomes the link in one transaction, keeping its repository and prefix. A GitHub token
 * channel cannot become a connection: it needs an App connection first. The channel's secret is
 * read only to build that connection, and never leaves this module but into the encrypted column.
 */
import { ALL_OUTPUTS, cappedOutputs } from "../adapters/notifier/outputs.ts";
import { githubApp } from "../integrations/git/connections/define.ts";
import { resolveLinkCoverage } from "../integrations/git/connections/link-host.ts";
import { GitChannelChangedError, replaceChannelWithLink } from "../models/git-channel-move.ts";
import {
  connectionFits,
  perProjectGitChannelOf,
  type PerProjectGitChannel,
} from "../models/git-channel.ts";
import {
  GitConnectionModel,
  type GitConnection,
  type GitConnectionInput,
} from "../models/git-connection.ts";
import type { NotificationChannelModel } from "../models/notification-channel.ts";
import type { GitConnectionRow, GitRepositoryLinkRow } from "../schema/git-connection.ts";
import type { LinkApprovalDeps } from "./link-approval.ts";
import { postsComments } from "./link-channel.ts";
import { requestOpenBuildStates } from "./resume.ts";

/** What a move needs: approval's dependencies, plus the channels (to read an App channel's key). */
export interface ChannelMoveDeps extends LinkApprovalDeps {
  channels: NotificationChannelModel;
}

/** Which connection takes the channel over. */
export type ChannelMoveTarget = { connectionId: string } | { fromChannel: true };

/** A move request: the channel as the site admin saw it (`updatedAt`) and the connection picked. */
export interface ChannelMoveRequest {
  channelId: string;
  updatedAt: string;
  target: ChannelMoveTarget;
  movedBy: string | null;
}

/** How a move ended. Not moved: the channel is unchanged. */
export type ChannelMove =
  | { moved: true; link: GitRepositoryLinkRow; connection: GitConnection; asked: number }
  | { moved: false; reason: "not-covered" | "unfit" | "needs-app" | "bad-key" };

/** A connection the move can use, with its secret (in memory only) and, if new, its row. */
interface Takeover {
  connection: GitConnection;
  secret: string;
  row?: GitConnectionRow;
}

/**
 * Move the channel. An inconclusive answer from the host throws, and the channel stays as it was.
 * @throws GitChannelChangedError when the channel is gone or changed since it was shown.
 * @throws GitRepositoryTakenError when a link or another channel holds the repository and prefix.
 */
export async function moveGitChannel(
  deps: ChannelMoveDeps,
  request: ChannelMoveRequest,
): Promise<ChannelMove> {
  const channel = await currentChannel(deps, request);
  const takeover = await takeoverOf(deps, channel, request);
  if (!("connection" in takeover)) {
    return { moved: false, reason: takeover.reason };
  }
  const coverage = await resolveLinkCoverage(takeover.connection, takeover.secret, channel);
  if (!coverage.covered) {
    return { moved: false, reason: "not-covered" };
  }
  const link = await replace(deps, channel, takeover, { ...coverage, movedBy: request.movedBy });
  const asked = await requestOpenBuildStates(deps, deps.publisher, {
    projectId: link.projectId,
    linkId: link.id,
  });
  return { moved: true, link, connection: takeover.connection, asked };
}

/** Write the move with what the coverage check pinned, and log it (ids only). */
async function replace(
  deps: ChannelMoveDeps,
  channel: PerProjectGitChannel,
  takeover: Takeover,
  pinned: { hostRepositoryId: string; installationId: string | null; movedBy: string | null },
): Promise<GitRepositoryLinkRow> {
  const link = await replaceChannelWithLink(deps.db, {
    channel,
    connection: takeover.row ? { row: takeover.row } : { id: takeover.connection.id },
    pins: { hostRepositoryId: pinned.hostRepositoryId, installationId: pinned.installationId },
    // A channel posted everything; the link keeps that, capped by its connection's ceiling.
    outputs: cappedOutputs(ALL_OUTPUTS, { pullRequests: postsComments(takeover.connection) }),
    movedBy: pinned.movedBy,
  });
  deps.logger.info(
    { channelId: channel.id, linkId: link.id, connectionId: link.connectionId },
    "git channel moved to a repository link",
  );
  return link;
}

async function currentChannel(
  deps: ChannelMoveDeps,
  request: ChannelMoveRequest,
): Promise<PerProjectGitChannel> {
  const row = await deps.channels.get(request.channelId);
  const channel = row === null ? null : perProjectGitChannelOf(row);
  if (channel === null || channel.updatedAt !== request.updatedAt) {
    throw new GitChannelChangedError();
  }
  return channel;
}

async function takeoverOf(
  deps: ChannelMoveDeps,
  channel: PerProjectGitChannel,
  request: ChannelMoveRequest,
): Promise<Takeover | { reason: Extract<ChannelMove, { moved: false }>["reason"] }> {
  if ("fromChannel" in request.target) {
    return await fromChannel(deps, channel, request.movedBy);
  }
  const connection = await deps.gitConnections.get(request.target.connectionId);
  if (connection === null || !connectionFits(channel, connection)) {
    return { reason: "unfit" };
  }
  const secret = await deps.gitConnections.secretOf(connection.id);
  return secret === null ? { reason: "unfit" } : { connection, secret };
}

/** A new App connection from a GitHub App channel's App id and key; a token channel has none. */
async function fromChannel(
  deps: ChannelMoveDeps,
  channel: PerProjectGitChannel,
  movedBy: string | null,
): Promise<Takeover | { reason: "needs-app" | "bad-key" }> {
  const row = channel.kind === "github-app" ? await deps.channels.get(channel.id) : null;
  if (row === null || channel.appId === null || row.secretEncrypted === null) {
    return { reason: "needs-app" };
  }
  const input = appOfChannel(
    { ...channel, appId: channel.appId },
    deps.channels.decryptSecret(row),
    movedBy,
  );
  if ("reason" in input) {
    return input;
  }
  const prepared = deps.gitConnections.prepare(input);
  return { connection: GitConnectionModel.viewOf(prepared), secret: input.secret, row: prepared };
}

/** The App connection a GitHub App channel's own id and key make; the error names no key. */
function appOfChannel(
  channel: PerProjectGitChannel & { appId: string },
  privateKey: string,
  movedBy: string | null,
): GitConnectionInput | { reason: "bad-key" } {
  try {
    const app = githubApp({
      id: "moved",
      appId: channel.appId,
      privateKey,
      apiUrl: channel.apiUrl ?? undefined,
      name: `GitHub App ${channel.appId}`,
    });
    return {
      provider: app.provider,
      name: app.name,
      apiBase: app.apiBase,
      config: { ...app.config },
      secret: app.readSecret(),
      createdBy: movedBy,
    };
  } catch {
    return { reason: "bad-key" };
  }
}
