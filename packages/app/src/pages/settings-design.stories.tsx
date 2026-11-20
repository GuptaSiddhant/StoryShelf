// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import type { RenderedContent } from "../shell/document.tsx";
import { project } from "../stories-fixtures/dataset.ts";
import {
  renderProjectSettingsPage,
  type ProjectSettingsData,
  type SettingsUnoffered,
} from "./project-settings.tsx";
import type { SettingsDesignProvider } from "./settings-design.tsx";

const meta: Meta = { title: "Pages/Settings/Design" };
export default meta;

const figma: SettingsDesignProvider = {
  kind: "figma",
  name: "Figma",
  credentialLabel: "Figma access token",
  credentialHelp: "A personal access token with file_content:read.",
  credentialPlaceholder: "figd_…",
  urlHint: "https://www.figma.com/design/<file>/<name>?node-id=1-2",
  maxAgeDays: 90,
  credential: null,
};

const figmaOff: SettingsUnoffered = {
  notifications: [],
  design: [{ kind: "figma", name: "Figma", reason: "Turned off by the operator" }],
};

/** The Capture & tests tab, where the Design section lives; only the design data differs per story. */
const settingsPage = (
  providers: SettingsDesignProvider[],
  unoffered?: SettingsUnoffered,
): RenderedContent =>
  renderProjectSettingsPage({
    project,
    activeTab: "capture",
    labelTypes: [],
    links: [],
    linkCandidates: [],
    design: { files: [], components: [], providers },
    tokens: [],
    members: [],
    groupMappings: [],
    webhooks: [],
    notificationChannels: [],
    notifyProviders: [],
    mySubscription: null,
    isAdmin: true,
    unoffered,
  } satisfies ProjectSettingsData);

/** Figma is offered: the file, component mapping and credential cards. */
export const Available = pageStory(() => settingsPage([figma]));

/** Figma is turned off, seen by a project admin: the Design section is left out, with no placeholder. */
export const UnavailableProjectAdmin = pageStory(() => settingsPage([]));

/** Figma is turned off, seen by a site admin: one line in place of the section, linking to System. */
export const UnavailableSiteAdmin = pageStory(() => settingsPage([], figmaOff));
