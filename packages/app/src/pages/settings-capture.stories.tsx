// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import type { Project } from "@storyshelf/core/schema";
import { onAPhone, pageStory } from "../../.storybook/page.tsx";
import type { RenderedContent } from "../shell/document.tsx";
import { project } from "../stories-fixtures/dataset.ts";
import {
  renderProjectSettingsPage,
  type ProjectSettingsData,
  type SettingsFormState,
} from "./project-settings.tsx";

const meta: Meta = { title: "Pages/Settings/Capture" };
export default meta;

/** The project settings page on its Capture tab; the superseded-builds card is the part that differs per story. */
const settingsPage = (
  changes: Partial<Project>,
  options: { isAdmin?: boolean; formState?: SettingsFormState } = {},
): RenderedContent =>
  renderProjectSettingsPage(
    {
      project: { ...project, ...changes },
      activeTab: "capture",
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
      isAdmin: options.isAdmin ?? true,
    } satisfies ProjectSettingsData,
    options.formState,
  );

/** On by default: the box is ticked for an admin, with the Save button. */
export const SupersededOn = pageStory(() => settingsPage({}));

/** Switched off: the box is clear. */
export const SupersededOff = pageStory(() => settingsPage({ cancelSuperseded: false }));

/** A member who is not an admin sees the setting but cannot change it or save. */
export const SupersededNotAdmin = pageStory(() => settingsPage({}, { isAdmin: false }));

/** The page on a 375px phone: the cards stack and the page must not scroll sideways. */
export const OnAPhone = onAPhone(pageStory(() => settingsPage({})));
