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

const meta: Meta = { title: "Pages/Settings/Review" };
export default meta;

/** The project settings page on its Review & notifications tab; the review card is the part that differs per story. */
const settingsPage = (
  changes: Partial<Project>,
  options: { isAdmin?: boolean; formState?: SettingsFormState } = {},
): RenderedContent =>
  renderProjectSettingsPage(
    {
      project: { ...project, ...changes },
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
      isAdmin: options.isAdmin ?? true,
    } satisfies ProjectSettingsData,
    options.formState,
  );

/** Review on with one approval required: the default for a new project. */
export const ReviewOn = pageStory(() => settingsPage({}));

/** Review on and two approvals required. */
export const ReviewTwoApprovals = pageStory(() => settingsPage({ reviewApprovals: 2 }));

/** Review off: the box is clear, and the hint says what saving does to builds waiting for a verdict. */
export const ReviewOff = pageStory(() => settingsPage({ reviewEnabled: false }));

/** A refused approvals count shows its error under the field. */
export const ReviewApprovalsError = pageStory(() =>
  settingsPage(
    { reviewApprovals: 0 },
    { formState: { errors: { reviewApprovals: "Approvals must be between 1 and 20." } } },
  ),
);

/** A member who is not an admin sees the settings but cannot change the review switch or save. */
export const ReviewNotAdmin = pageStory(() => settingsPage({}, { isAdmin: false }));

/** The page on a 375px phone: the review card stacks and the page must not scroll sideways. */
export const OnAPhone = onAPhone(pageStory(() => settingsPage({})));
