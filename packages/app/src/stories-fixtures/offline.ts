import type { OfflineUsage } from "../pages/offline-device-model.ts";
import type { OfflineHomeProject } from "../shell/service-worker-home.ts";
import { hoursAgo } from "./time.ts";

const MB = 1024 * 1024;

/** Projects the device page lists (the viewer's visible projects). */
export const OFFLINE_PROJECTS = [
  { slug: "design-system", name: "Design system" },
  { slug: "web-app", name: "Web app" },
  { slug: "docs", name: "Docs" },
];

const designSystem: OfflineHomeProject = {
  name: "Design system",
  commit: "9f3c2a1b7d",
  syncedAt: hoursAgo(3),
  maxOfflineDays: 30,
};

/** What the worker keeps for the offline home page: two fresh projects. */
export const OFFLINE_HOME_PROJECTS: Record<string, OfflineHomeProject> = {
  "design-system": designSystem,
  "web-app": {
    name: "Web app",
    commit: "41be0c9e22",
    syncedAt: hoursAgo(24 * 5),
    maxOfflineDays: 30,
  },
};

/** One kept project past its expiry (31 days since its last sync, limit 30). */
export const OFFLINE_HOME_EXPIRED: Record<string, OfflineHomeProject> = {
  "design-system": designSystem,
  docs: { name: "Docs", commit: "c0ffee1234", syncedAt: hoursAgo(24 * 31), maxOfflineDays: 30 },
};

/** Nothing kept yet on a device with the default 500 MB cap. */
export const USAGE_EMPTY: OfflineUsage = {
  usedBytes: 0,
  capBytes: 500 * MB,
  persisted: false,
  projects: [],
};

/** Two projects kept, well under the cap. */
export const USAGE_UNDER_CAP: OfflineUsage = {
  usedBytes: 142 * MB,
  capBytes: 500 * MB,
  persisted: true,
  projects: [
    {
      slug: "design-system",
      name: "Design system",
      commit: "9f3c2a1b7d",
      buildId: "01JD000000000000000000BLD001",
      size: 96 * MB,
      syncedAt: hoursAgo(3),
      expired: false,
    },
    {
      slug: "web-app",
      name: "Web app",
      commit: "41be0c9e22",
      buildId: "01JD000000000000000000BLD002",
      size: 58 * MB,
      syncedAt: hoursAgo(24 * 5),
      expired: false,
    },
  ],
};

/** Everything kept and the cap reached: adding another project is refused with its size. */
export const USAGE_AT_CAP: OfflineUsage = {
  ...USAGE_UNDER_CAP,
  usedBytes: 250 * MB,
  capBytes: 250 * MB,
};
