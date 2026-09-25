import type { AdapterSetupResult, AdapterSetupSources } from "@storyshelf/core/adapter/setup";
import type { ShelfRouter } from "../app-types.ts";
import { renderAdminSystemPage } from "../pages/admin-system.tsx";
import { getStore } from "../store.ts";
import { collectHealthReport } from "./health-report.ts";
import { requireSiteAdmin } from "./helpers.ts";

/** Dependencies for the admin System page (same probing inputs as deep health). */
export interface AdminPageDeps {
  sources: AdapterSetupSources;
  getSettled: () => AdapterSetupResult | null;
  bootTimeMs: number;
  version: string;
}

/** Register the site-admin System page (adapter inventory + in-depth health). */
export function registerAdminPages(app: ShelfRouter, deps: AdminPageDeps): void {
  app.get("/admin", async (c) => {
    requireSiteAdmin(c);
    const report = await collectHealthReport(
      deps.sources,
      deps.getSettled(),
      deps.bootTimeMs,
      deps.version,
    );
    const { authEnabled, config } = getStore();
    c.header("Cache-Control", "no-store");
    return c.html(renderAdminSystemPage({ report, authEnabled, config }));
  });
}
