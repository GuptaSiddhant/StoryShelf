// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import { jsxStory } from "../../.storybook/render.tsx";
import type { RenderedContent } from "../shell/document.tsx";
import { project } from "../stories-fixtures/dataset.ts";
import { Card } from "../ui/components.tsx";
import { GitLinkForm } from "./git-link-form.tsx";
import { renderProjectSettingsPage, type ProjectSettingsData } from "./project-settings.tsx";
import type { SettingsGitData, SettingsGitLink } from "./settings-git.tsx";

const meta: Meta = { title: "Pages/Project/Settings/Git" };
export default meta;

const base: SettingsGitLink = {
  id: "01JD00000000000000000LINK01",
  repository: "acme/design-system",
  url: "https://github.com/acme/design-system",
  prefix: "storyshelf",
  connectionName: "Acme GitHub App",
  state: "approved",
  managed: false,
  reason: null,
  lastDeliveredAt: "2026-01-15T08:00:00.000Z",
  outputs: { storybook: true, comment: "always", annotations: true },
  commentAllowed: true,
};

const gitPage = (
  git: SettingsGitData | null,
  extra: Partial<ProjectSettingsData> = {},
): RenderedContent =>
  renderProjectSettingsPage({
    project,
    activeTab: "review",
    labelTypes: [],
    links: [],
    linkCandidates: [],
    design: { files: [], components: [], providers: [] },
    tokens: [],
    members: [],
    groupMappings: [],
    webhooks: [],
    notificationChannels: [],
    notifyProviders: [],
    mySubscription: null,
    isAdmin: true,
    git: git ?? undefined,
    ...extra,
  });

const data = (...links: SettingsGitLink[]): SettingsGitData => ({
  links,
  proposedPrefix: "storyshelf",
});

/** No link yet: the empty state offers the one action. */
export const NoLinks = pageStory(() => gitPage(data()));

/** Connected: the required check, the last delivery and the connection. */
export const Connected = pageStory(() => gitPage(data(base)));

/** Waiting for a site admin: nothing is posted until then. */
export const WaitingForApproval = pageStory(() =>
  gitPage(data({ ...base, state: "pending", lastDeliveredAt: null })),
);

/** Refused by a site admin, with the reason they gave. */
export const Refused = pageStory(() =>
  gitPage(
    data({
      ...base,
      state: "refused",
      reason: "This repository belongs to another team.",
      lastDeliveredAt: null,
    }),
  ),
);

/** Broken: the host no longer reaches the repository; the reason and the way back. */
export const Broken = pageStory(() =>
  gitPage(
    data({
      ...base,
      state: "broken",
      reason: "The GitHub App is no longer installed on this repository",
    }),
  ),
);

/** Declared in configuration: no Edit or Remove. */
export const ManagedByConfiguration = pageStory(() => gitPage(data({ ...base, managed: true })));

/** Several links side by side, one in each state. */
export const Mixed = pageStory(() =>
  gitPage(
    data(
      base,
      { ...base, id: "2", repository: "acme/docs", prefix: "docs", state: "pending" },
      {
        ...base,
        id: "3",
        repository: "acme/web",
        prefix: "web",
        state: "broken",
        reason: "The host refused the connection",
      },
    ),
  ),
);

/** A viewer who is not a project admin sees the links but no actions. */
export const ReadOnly = pageStory(() => gitPage(data(base), { isAdmin: false }));

/** A site admin on a server with no connection: one line pointing to System → Git. */
export const NoConnectionSiteAdmin = pageStory(() =>
  gitPage(null, { unoffered: { notifications: [], design: [], git: true } }),
);

/** A project admin on a server with no connection: no Git section at all. */
export const NoConnectionProjectAdmin = pageStory(() => gitPage(null));

/** The link form in its dialog, operator switch off: a typed URL and a prefix, no picker. */
export const LinkForm = jsxStory(() => (
  <Card>
    <GitLinkForm project={project} data={data()} inDialog />
  </Card>
));

const repositories = ["acme/design-system", "acme/docs", "acme/web"].map((name) => ({
  url: `https://github.com/${name}`,
  label: name,
}));

/** Operator switch on: choose a covered repository, or type a URL. */
export const LinkFormPicker = jsxStory(() => (
  <Card>
    <GitLinkForm
      project={project}
      data={{ ...data(), picker: { listed: true, repositories, truncated: false } }}
      inDialog
    />
  </Card>
));

/** Switch on, the list hit the page cap: the form says it is cut short and points to the URL. */
export const LinkFormPickerTruncated = jsxStory(() => (
  <Card>
    <GitLinkForm
      project={project}
      data={{ ...data(), picker: { listed: true, repositories, truncated: true } }}
      inDialog
    />
  </Card>
));

/** Switch on, listing failed: the typed URL, with a note and nothing about why. */
export const LinkFormPickerFailed = jsxStory(() => (
  <Card>
    <GitLinkForm project={project} data={{ ...data(), picker: { listed: false } }} inDialog />
  </Card>
));

/** The link form after a refused submit: the same answer for any repository (no probing). */
export const LinkFormRefused = jsxStory(() => (
  <Card>
    <GitLinkForm
      project={project}
      data={data()}
      inDialog
      state={{
        errors: { repository: "Enter the repository's URL on a host this server connects to." },
        values: { repository: "not a url", prefix: "storyshelf" },
      }}
    />
  </Card>
));

/** The edit form of a connected link: outputs, all within the connection's ceiling. */
export const EditForm = jsxStory(() => (
  <Card>
    <GitLinkForm project={project} data={data(base)} link={base} inDialog />
  </Card>
));

/** The edit form when the connection may not comment: that option is unavailable, with the reason. */
export const EditFormAboveCeiling = jsxStory(() => {
  const link = { ...base, commentAllowed: false };
  return (
    <Card>
      <GitLinkForm project={project} data={data(link)} link={link} inDialog />
    </Card>
  );
});
