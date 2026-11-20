// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import {
  renderAdminGitPage,
  type AdminGitData,
  type GitConnectionView,
  type GitLinkRequestView,
} from "./admin-git.tsx";
import { renderGitConnectionForm, type GitConnectionFormData } from "./git-connection-form.tsx";
import {
  renderGitHubConfirmPage,
  renderGitHubContinuePage,
  renderGitHubFlowEnded,
  type GitHubAppChoice,
} from "./git-github-flow.tsx";
import {
  ApproveLinkBody,
  RefuseLinkBody,
  renderLinkDialogPage,
  type GitCoverageView,
} from "./git-link-dialogs.tsx";

const meta: Meta = { title: "Pages/System/Git" };
export default meta;

const ORIGIN = "https://shelf.example.com";

const githubApp: GitConnectionView = {
  id: "01JCONNGITHUB0000000000000",
  name: "Acme StoryShelf",
  providerLabel: "GitHub App",
  account: "acme",
  posts: ["check runs", "pull-request comment"],
  linked: 3,
  health: { state: "ok", detail: "App acme-storyshelf" },
  managed: false,
  ignored: false,
  installUrl: "https://github.com/apps/acme-storyshelf/installations/new",
};

const configuredApp: GitConnectionView = {
  ...githubApp,
  id: "github",
  name: "Platform App",
  account: "platform on ghes.example.com",
  posts: ["check runs", "pull-request comment", "commit statuses"],
  linked: 12,
  managed: true,
  installUrl: undefined,
};

const gitlab: GitConnectionView = {
  id: "01JCONNGITLAB0000000000000",
  name: "Acme GitLab",
  providerLabel: "GitLab token",
  account: "acme/web on gitlab.com",
  posts: ["commit statuses", "merge-request comment"],
  linked: 1,
  health: { state: "warning", detail: "Token expires on 2026-12-10 (in 20 days)" },
  expiresOn: "2026-12-10",
  managed: false,
  ignored: false,
};

const shadowed: GitConnectionView = {
  ...githubApp,
  id: "github",
  name: "Old platform App",
  linked: 0,
  health: { state: "unknown", detail: "Not probed" },
  ignored: true,
  installUrl: undefined,
};

const failing: GitConnectionView = {
  ...githubApp,
  id: "01JCONNFAILING000000000000",
  name: "Legacy App",
  linked: 0,
  health: { state: "failed", detail: "GitHub answered HTTP 401" },
};

const pending: GitLinkRequestView = {
  id: "01JLINKPENDING000000000000",
  state: "pending",
  repository: "acme/web",
  prefix: "",
  project: { name: "Web", href: "/projects/web/settings/review" },
  connectionName: "Acme StoryShelf",
  reason: null,
  requestedAt: "2026-11-20T10:00:00.000Z",
};

const broken: GitLinkRequestView = {
  ...pending,
  id: "01JLINKBROKEN0000000000000",
  state: "broken",
  repository: "acme/docs",
  prefix: "docs",
  project: { name: "Docs", href: "/projects/docs/settings/review" },
  reason: "The GitHub App is no longer installed on this repository",
};

const page = (overrides: Partial<AdminGitData> = {}): AdminGitData => ({
  connections: [githubApp, configuredApp, gitlab],
  requests: [pending, broken],
  anyRepository: false,
  origin: ORIGIN,
  ...overrides,
});

export const Empty = pageStory(() => renderAdminGitPage(page({ connections: [], requests: [] })));

export const Connected = pageStory(() => renderAdminGitPage(page()));

export const NeedsAttention = pageStory(() =>
  renderAdminGitPage(page({ connections: [failing, shadowed, configuredApp], requests: [broken] })),
);

export const OperatorSwitchOn = pageStory(() =>
  renderAdminGitPage(page({ requests: [], anyRepository: true })),
);

export const NoPublicOrigin = pageStory(() =>
  renderAdminGitPage(page({ connections: [], requests: [], origin: null })),
);

const form = (overrides: Partial<GitConnectionFormData> = {}): GitConnectionFormData => ({
  kind: "github-manifest",
  values: {},
  errors: {},
  origin: ORIGIN,
  ...overrides,
});

export const AddConnectGitHub = pageStory(() => renderGitConnectionForm(form()));

export const AddWithoutPublicOrigin = pageStory(() =>
  renderGitConnectionForm(form({ origin: null })),
);

export const AddExistingApp = pageStory(() =>
  renderGitConnectionForm(
    form({
      kind: "github-app",
      values: { app_name: "Acme App", app_id: "12345" },
      errors: { app_key: "Paste the App's PEM private key" },
    }),
  ),
);

export const AddGitLabToken = pageStory(() =>
  renderGitConnectionForm(
    form({
      kind: "gitlab-token",
      values: { gl_host: "https://gitlab.com", gl_group: "acme/web" },
      gitlabTokenUrl:
        "https://gitlab.com/groups/acme/web/-/settings/access_tokens?name=StoryShelf&scopes=api",
    }),
  ),
);

const choice: GitHubAppChoice = {
  name: "Acme StoryShelf",
  organization: "acme",
  apiUrl: "",
  permissions: ["Checks: write", "Contents: read (compare only)", "Pull requests: write"],
};

export const ContinueOnGitHub = pageStory(() =>
  renderGitHubContinuePage({
    formUrl: "https://github.com/organizations/acme/settings/apps/new?state=gss_story",
    manifest: "{}",
    choice,
  }),
);

export const ConfirmGitHubApp = pageStory(() =>
  renderGitHubConfirmPage({ state: "gss_story", code: "story-code", choice }),
);

export const SetupEnded = pageStory(() =>
  renderGitHubFlowEnded({
    message:
      "It expired, was already used, or was started in another browser session. Each setup is valid for ten minutes, once.",
  }),
);

const approve = (
  coverage: GitCoverageView,
  link: GitLinkRequestView = pending,
): ReturnType<typeof renderLinkDialogPage> =>
  renderLinkDialogPage(
    link.state === "broken" ? "Reconnect repository link" : "Approve repository link",
    <ApproveLinkBody link={link} coverage={coverage} target="body" />,
  );

export const ApproveCovered = pageStory(() =>
  approve({ kind: "covered", repositoryId: "812345678", installationId: "4567890" }),
);

export const ApproveNotCovered = pageStory(() =>
  approve({ kind: "not-covered", installUrl: githubApp.installUrl }),
);

export const ApproveUnreachable = pageStory(() =>
  approve({ kind: "unreachable", detail: "HTTP 502" }),
);

export const ReconnectWithoutConnection = pageStory(() =>
  approve({ kind: "no-connection" }, broken),
);

export const Refuse = pageStory(() =>
  renderLinkDialogPage("Refuse repository link", <RefuseLinkBody link={pending} target="body" />),
);
