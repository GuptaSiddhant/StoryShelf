// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta, StoryObj } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import {
  OFFLINE_PROJECTS,
  PUSH_DEVICES,
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

type PushState = "unsupported" | "idle" | "enabled" | "denied";

function pushPage(state: PushState, devices: typeof PUSH_DEVICES = PUSH_DEVICES): StoryObj {
  return pageStory(
    () =>
      renderOfflineDevicePage({
        projects: OFFLINE_PROJECTS,
        hostingMode: "trusted",
        usage: USAGE_EMPTY,
        push: { devices, clientState: state },
      }),
    opts,
  );
}

/** The browser has no push support: the card says so. (Push off on the server shows no card: see the stories above.) */
export const PushUnavailable = pushPage("unsupported", []);

/** Not enabled on this device yet: the enable button, no devices listed. */
export const PushNotEnabled = pushPage("idle", []);

/** Enabled: this device and another, each with its last delivery. */
export const PushEnabledTwoDevices = pushPage("enabled");

/** The browser blocks notifications: explains how to allow them. */
export const PushPermissionDenied = pushPage("denied");
