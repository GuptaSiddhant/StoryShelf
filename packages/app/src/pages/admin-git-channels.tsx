/**
 * The per-project git channels on System → Git (ADR 0054, decision 8): each remaining channel with a
 * one-click move to an approved repository link, the warning that names the release in which they
 * stop (the move dialog is `git-channel-dialogs.tsx`). Presentational: a view never holds a token or a private key.
 */
import type { HtmlEscapedString } from "hono/utils/html";
import {
  Alert,
  Card,
  Dialog,
  DialogLink,
  Meta,
  SectionTitle,
  SummaryList,
} from "../ui/components.tsx";

/** One remaining channel as site admins see it. */
export interface GitChannelView {
  id: string;
  kind: "github-app" | "github-token" | "gitlab-token";
  /** "GitHub App", "GitHub token" or "GitLab token". */
  kindLabel: string;
  /** `owner/repo`. */
  repository: string;
  /** API host, e.g. `api.github.com`. */
  host: string;
  /** The status prefix; empty for the default. */
  prefix: string;
  enabled: boolean;
  /** The row's last change; the move posts it back, so a channel edited meanwhile is not moved. */
  updatedAt: string;
  project: { name: string; href: string } | null;
  /** Connections that can take it over: the right provider on the same host. */
  connections: readonly { id: string; name: string }[];
  /** A GitHub App channel can become a connection of its own. */
  canCreate: boolean;
}

/** Why the dialog shows the move again instead of closing. */
export type GitChannelMoveProblem =
  | { kind: "not-covered"; installUrl?: string | undefined }
  | { kind: "unreachable"; detail: string }
  | { kind: "taken" }
  | { kind: "unfit" }
  | { kind: "bad-key" };

/** The dialog the move action opens into. */
export const CHANNEL_DIALOG_ID = "git-channel";

/** The `connection` value that makes the channel's own App a connection. */
export const FROM_CHANNEL = "from-channel";

/** The warning: unmoved channels stop posting in `release`. */
export function GitChannelsWarning(props: {
  count: number;
  release: string;
  /** Where the move happens; absent on System → Git itself. */
  href?: string | undefined;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const { count, release, href } = props;
  if (count === 0) {
    return null;
  }
  const what = count === 1 ? "1 per-project git channel" : `${count} per-project git channels`;
  return (
    <Alert tone="warning" title={`${what} stop posting in ${release}`}>
      Per-project git credentials are removed in StoryShelf {release}. A channel not moved to a
      repository link by then stops posting its status, and a required check that stops posting
      blocks merges. {href ? <a href={href}>Move them on System › Git</a> : "Move each one below."}
    </Alert>
  );
}

function channelDetails(channel: GitChannelView): string {
  return [
    channel.project ? `For ${channel.project.name}` : "Project removed",
    `${channel.kindLabel} on ${channel.host}`,
    channel.prefix ? `prefix ${channel.prefix}` : "",
    channel.enabled ? "" : "Disabled",
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

/** The remaining channels, each with Move. */
export function GitChannelsCard(props: {
  channels: readonly GitChannelView[];
  release: string;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const { channels, release } = props;
  if (channels.length === 0) {
    return null;
  }
  const items = channels.map((channel) => ({
    id: channel.id,
    name: channel.repository,
    state: { label: "Stops in " + release, tone: "warning" as const },
    details: channelDetails(channel),
    actions: (
      <DialogLink
        dialogId={CHANNEL_DIALOG_ID}
        href={`/admin/git/channels/${channel.id}/move`}
        variant="secondary"
        size="sm"
      >
        Move
      </DialogLink>
    ),
  }));
  return (
    <Card>
      <SectionTitle>Per-project channels</SectionTitle>
      <GitChannelsWarning count={channels.length} release={release} />
      <Meta>
        Moving a channel makes it an approved repository link through a connection, with the same
        repository and status prefix, so branch protection keeps its check. Its token or key is then
        deleted. A GitHub token channel moves to a GitHub App connection; add one first.
      </Meta>
      <SummaryList
        label="Per-project git channels"
        items={items}
        emptyTitle="No per-project channels"
      />
      <Dialog id={CHANNEL_DIALOG_ID} title="Move git channel" />
    </Card>
  );
}
