// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import type { GitChannelMoveProblem, GitChannelView } from "./admin-git-channels.tsx";
import { renderAdminGitPage } from "./admin-git.tsx";
import { MoveChannelBody } from "./git-channel-dialogs.tsx";
import { renderLinkDialogPage } from "./git-link-dialogs.tsx";

const meta: Meta = { title: "Pages/System/Git channels" };
export default meta;

const APP_ID = "01JCONNGITHUB0000000000000";

const tokenChannel: GitChannelView = {
  id: "01JCHANNELTOKEN00000000000",
  kind: "github-token",
  kindLabel: "GitHub token",
  repository: "acme/web",
  host: "api.github.com",
  prefix: "",
  enabled: true,
  updatedAt: "2026-11-20T10:00:00.000Z",
  project: { name: "Web", href: "/projects/web/settings/notifications" },
  connections: [{ id: APP_ID, name: "Acme StoryShelf" }],
  canCreate: false,
};

const appChannel: GitChannelView = {
  ...tokenChannel,
  id: "01JCHANNELAPP0000000000000",
  kind: "github-app",
  kindLabel: "GitHub App",
  repository: "acme/docs",
  prefix: "docs",
  project: { name: "Docs", href: "/projects/docs/settings/notifications" },
  connections: [],
  canCreate: true,
};

const gitlabChannel: GitChannelView = {
  ...tokenChannel,
  id: "01JCHANNELGITLAB0000000000",
  kind: "gitlab-token",
  kindLabel: "GitLab token",
  repository: "acme/mobile",
  host: "gitlab.example.com",
  enabled: false,
  project: { name: "Mobile", href: "/projects/mobile/settings/notifications" },
  connections: [],
};

export const WithChannelsToMove = pageStory(() =>
  renderAdminGitPage({
    connections: [],
    requests: [],
    anyRepository: false,
    origin: "https://shelf.example.com",
    channels: [tokenChannel, appChannel, gitlabChannel],
    stopRelease: "0.19.0",
  }),
);

const move = (
  channel: GitChannelView,
  problem?: GitChannelMoveProblem,
): ReturnType<typeof renderLinkDialogPage> =>
  renderLinkDialogPage(
    "Move git channel",
    <MoveChannelBody channel={channel} target="body" problem={problem} />,
  );

export const MoveToConnection = pageStory(() => move(tokenChannel));

export const MoveFromChannelApp = pageStory(() => move(appChannel));

export const MoveNeedsConnection = pageStory(() => move(gitlabChannel));

export const MoveNotCovered = pageStory(() =>
  move(tokenChannel, {
    kind: "not-covered",
    installUrl: "https://github.com/apps/acme-storyshelf/installations/new",
  }),
);

export const MoveUnreachable = pageStory(() =>
  move(tokenChannel, { kind: "unreachable", detail: "HTTP 502" }),
);

export const MoveTaken = pageStory(() => move(tokenChannel, { kind: "taken" }));

export const MoveBadKey = pageStory(() => move(appChannel, { kind: "bad-key" }));
