// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import type { RenderedContent } from "../shell/document.tsx";
import { project } from "../stories-fixtures/dataset.ts";
import { hoursAgo } from "../stories-fixtures/time.ts";
import {
  renderProjectSettingsPage,
  type ProjectSettingsData,
  type SettingsFormState,
} from "./project-settings.tsx";
import type { SettingsTab } from "./settings-tabs.ts";

const meta: Meta = { title: "Pages/Settings/Links, AI and labels" };
export default meta;

const labelTypes: ProjectSettingsData["labelTypes"] = [
  {
    id: "lbl1",
    projectId: project.id,
    key: "pr",
    name: "Pull request",
    linkTemplate: "https://github.com/{repo}/pull/{value}",
    color: null,
    createdAt: hoursAgo(900),
  },
  {
    id: "lbl2",
    projectId: project.id,
    key: "release",
    name: "Release",
    linkTemplate: null,
    color: null,
    createdAt: hoursAgo(900),
  },
];

const page = (
  tab: SettingsTab,
  changes: Partial<ProjectSettingsData> = {},
  formState?: SettingsFormState,
): RenderedContent =>
  renderProjectSettingsPage(
    {
      project,
      activeTab: tab,
      labelTypes,
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
      ...changes,
    },
    formState,
  );

const links = [
  { packageName: "@acme/tokens", upstreamSlug: "web-app", upstreamName: "Web app" },
  { packageName: "@acme/icons", upstreamSlug: "web-app", upstreamName: "Web app" },
];
const candidates = [{ slug: "web-app", name: "Web app" }];

/** General with two package links and the form to link another upstream project. */
export const PackageLinks = pageStory(() => page("general", { links, linkCandidates: candidates }));

/** A member who is not an admin sees the links but not the Add form or Remove. */
export const PackageLinksNotAdmin = pageStory(() =>
  page("general", { links, linkCandidates: candidates, isAdmin: false }),
);

/** A refused link: the error sits above the section. */
export const PackageLinkRefused = pageStory(() =>
  page(
    "general",
    { links, linkCandidates: candidates, formSection: "links" },
    { globalError: "That package is already linked." },
  ),
);

const aiData = (isSiteAdmin: boolean): NonNullable<ProjectSettingsData["ai"]> => ({
  available: true,
  profiles: ["insight", "design-summary"],
  defaultProfile: "insight",
  isSiteAdmin,
});

/** Capture & tests with AI configured, for a site admin who can pick the profile. */
export const AiSiteAdmin = pageStory(() => page("capture", { ai: aiData(true) }));

/** The same section for a project admin who is not a site admin: the profile is read-only. */
export const AiProjectAdmin = pageStory(() => page("capture", { ai: aiData(false) }));

/** A refused profile change. */
export const AiRefused = pageStory(() =>
  page(
    "capture",
    { ai: aiData(true), formSection: "ai" },
    { globalError: "That AI profile is not configured on this server." },
  ),
);

/** Review & notifications with the project's label types listed. */
export const LabelTypes = pageStory(() => page("review"));

/** A label type's edit form open. */
export const LabelEditing = pageStory(() => page("review", {}, { editKey: "release" }));

/** A refused label edit: the error is shown with the form still open. */
export const LabelEditRefused = pageStory(() =>
  page(
    "review",
    { formSection: "labels" },
    { editKey: "release", errors: { name: "Enter a name for the label." } },
  ),
);
