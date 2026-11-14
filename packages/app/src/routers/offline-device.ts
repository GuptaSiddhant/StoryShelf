import { hostingModeOf } from "@storyshelf/core/config";
import { ProjectModel } from "@storyshelf/core/models";
import type { ShelfRouter } from "../app-types.ts";
import { renderOfflineDevicePage } from "../pages/offline-device.tsx";
import { getStore } from "../store.ts";

/**
 * `GET /profile/offline`: this device's offline Storybook settings (ADR 0048, decision 3). It is
 * registered with or without auth, because a deployment without sign-in can keep Storybooks too.
 * The sync endpoint alone decides what each caller may keep.
 */
export function registerOfflineDevicePage(app: ShelfRouter): void {
  app.get("/profile/offline", async (c) => {
    const { db, config } = getStore();
    const projects = (await new ProjectModel(db).list()).map(({ slug, name }) => ({ slug, name }));
    c.header("Cache-Control", "no-store");
    return c.html(await renderOfflineDevicePage({ projects, hostingMode: hostingModeOf(config) }));
  });
}
