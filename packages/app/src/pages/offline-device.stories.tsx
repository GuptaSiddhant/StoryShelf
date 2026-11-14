// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import {
  OFFLINE_PROJECTS,
  USAGE_AT_CAP,
  USAGE_EMPTY,
  USAGE_UNDER_CAP,
} from "../stories-fixtures/offline.ts";
import { renderOfflineDevicePage } from "./offline-device.tsx";

const meta: Meta = { title: "Pages/Account/This device" };
export default meta;

const opts = { store: { authEnabled: true } };

export const NothingKept = pageStory(
  () =>
    renderOfflineDevicePage({
      projects: OFFLINE_PROJECTS,
      hostingMode: "trusted",
      usage: USAGE_EMPTY,
    }),
  opts,
);

export const UnderCap = pageStory(
  () =>
    renderOfflineDevicePage({
      projects: OFFLINE_PROJECTS,
      hostingMode: "trusted",
      usage: USAGE_UNDER_CAP,
    }),
  opts,
);

export const AtCap = pageStory(
  () =>
    renderOfflineDevicePage({
      projects: OFFLINE_PROJECTS,
      hostingMode: "trusted",
      usage: USAGE_AT_CAP,
    }),
  opts,
);

/** Outside `trusted` hosting mode the page says why and offers nothing to keep. */
export const HostingModeUnavailable = pageStory(
  () => renderOfflineDevicePage({ projects: OFFLINE_PROJECTS, hostingMode: "sandboxed" }),
  opts,
);
