// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { onAPhone, pageStory } from "../../.storybook/page.tsx";
import { BUILD_MAIN, builds, project } from "../stories-fixtures/dataset.ts";
import { hoursAgo } from "../stories-fixtures/time.ts";
import {
  renderDesignCoveragePage,
  type CoverageComponent,
  type DesignCoverageData,
} from "./design-coverage.tsx";

const meta: Meta = { title: "Pages/Library/Design coverage" };
export default meta;

const accepted = builds.find((item) => item.id === BUILD_MAIN) ?? null;

const component = (title: string, importPath: string, stories: number): CoverageComponent => ({
  title,
  importPath,
  stories,
  links: [],
});

const withLink = (
  base: CoverageComponent,
  drift: "stale" | "deleted" | "current",
): CoverageComponent => ({
  ...base,
  links: [
    {
      url: "https://www.figma.com/design/abc123/Kit?node-id=12-34",
      providerName: "Figma",
      name: `${base.title} / Default`,
      drift,
      changedAt: drift === "current" ? null : hoursAgo(30),
    },
  ],
});

const button = component("Kit / Button", "./src/kit/button.stories.tsx", 4);
const card = component("Kit / Card", "./src/kit/card.stories.tsx", 3);
const modal = component("Kit / Modal", "./src/kit/modal.stories.tsx", 2);
const tabs = component("Kit / Tabs", "./src/kit/tabs.stories.tsx", 5);

const data = (changes: Partial<DesignCoverageData> = {}): DesignCoverageData => ({
  project,
  build: accepted,
  unlinked: [card, modal],
  drifted: [withLink(button, "stale"), withLink(tabs, "deleted")],
  current: 6,
  unknown: 0,
  withoutToken: [],
  lastChecked: hoursAgo(2),
  storyLinksRead: true,
  ...changes,
});

/** Components without a design, components whose design drifted, and how many are in sync. */
export const Mixed = pageStory(() => renderDesignCoveragePage(data()));

/** Everything linked and up to date: the unlinked section says so, nothing needs attention. */
export const AllInSync = pageStory(() =>
  renderDesignCoveragePage(data({ unlinked: [], drifted: [], current: 12 })),
);

/** A provider has no token, so drift cannot be told: "Needs attention" reads Unavailable. */
export const DriftUnavailable = pageStory(() =>
  renderDesignCoveragePage(data({ drifted: [], unknown: 5, current: 1, withoutToken: ["Figma"] })),
);

/** Capture is off: only links mapped in the project's design settings are counted, and the page says so. */
export const WithoutTesting = pageStory(() =>
  renderDesignCoveragePage(data({ storyLinksRead: false })),
);

/** No accepted build yet: nothing to read, and a way to the builds. */
export const NoBuildYet = pageStory(() =>
  renderDesignCoveragePage(
    data({ build: null, unlinked: [], drifted: [], current: 0, lastChecked: null }),
  ),
);

/** The tables on a 375px phone: secondary columns drop out and the path moves under the title. */
export const OnAPhone = onAPhone(pageStory(() => renderDesignCoveragePage(data())));
