import type { AdapterSetupResult, AdapterSetupSources } from "@storyshelf/core/adapter/setup";
import type { Auth } from "@storyshelf/core/auth";
import { describeCaptureHost } from "@storyshelf/core/utils";
import type { ShelfRouter } from "../app-types.ts";
import { loadCredentialProbe, reencryptWithCurrent } from "../credentials.ts";
import { countHiddenSnapshots } from "../hidden-data.ts";
import { insightDepsFromStore } from "../insights/deps.ts";
import { buildUsageReport } from "../insights/usage-report.ts";
import { notificationsPaused } from "../notifications-pause.ts";
import { renderAdminAiPage } from "../pages/admin-ai.tsx";
import { renderAdminSystemPage, type AdminSystemData } from "../pages/admin-system.tsx";
import { getStore } from "../store.ts";
import { runnerTargets } from "../targets.ts";
import { flash } from "./flash.ts";
import { collectHealthReport } from "./health-report.ts";
import { requireSiteAdmin } from "./helpers.ts";
import { hxRedirect } from "./htmx.ts";

/** Dependencies for the admin System page (same probing inputs as deep health). */
export interface AdminPageDeps {
  sources: AdapterSetupSources;
  getSettled: () => AdapterSetupResult | null;
  bootTimeMs: number;
  version: string;
}

/** Register the site-admin System page (adapter inventory + in-depth health). */
export function registerAdminPages(app: ShelfRouter, deps: AdminPageDeps, auth?: Auth): void {
  app.get("/admin", async (c) => {
    requireSiteAdmin(c);
    const { authEnabled, config, db, capturesHere, captureConcurrency, testing } = getStore();
    const credentials = await loadCredentialProbe(db, config);
    const report = await collectHealthReport(
      deps.sources,
      deps.getSettled(),
      deps.bootTimeMs,
      deps.version,
      credentials,
    );
    const authMethods = auth?.loginMethods().map((method) => method.label);
    c.header("Cache-Control", "no-store");
    return c.html(
      renderAdminSystemPage({
        report,
        authEnabled,
        config,
        authMethods,
        credentials,
        aiEnabled: getStore().ai !== undefined,
        testing,
        hiddenSnapshots: testing ? 0 : await countHiddenSnapshots(db),
        ...(await captureView()),
        // Only a host that runs capture jobs is sized here; a remote consumer sizes itself.
        capture: capturesHere === true ? describeCaptureHost(captureConcurrency) : null,
      }),
    );
  });

  app.get("/admin/ai", async (c) => {
    requireSiteAdmin(c);
    const aiDeps = insightDepsFromStore();
    if (!aiDeps) {
      return c.notFound();
    }
    c.header("Cache-Control", "no-store");
    return c.html(renderAdminAiPage(await buildUsageReport(aiDeps)));
  });

  app.post("/admin/credentials/reencrypt", async (c) => {
    requireSiteAdmin(c);
    const { db, config } = getStore();
    if (!config.previousSecret) {
      flash(c, "No previous secret is configured", "warning");
      return hxRedirect(c, "/admin");
    }
    const result = await reencryptWithCurrent(db, config);
    flash(c, reencryptMessage(result), result.failed > 0 ? "warning" : "success");
    return hxRedirect(c, "/admin");
  });
}

function reencryptMessage(result: { reencrypted: number; failed: number }): string {
  const base = `Re-encrypted ${result.reencrypted} credential(s)`;
  return result.failed > 0 ? `${base}; ${result.failed} failed — see server logs` : base;
}

/** Whether the System page warns that notifications are paused. */
async function pausedView(): Promise<boolean> {
  const store = getStore();
  return store.notifiers.length > 0 && (await notificationsPaused(store));
}

/** The System page's capture browsers and public origin (ADR 0007). */
async function captureView(): Promise<
  Pick<AdminSystemData, "targets" | "publicOrigin" | "notificationsPaused">
> {
  return {
    targets: await runnerTargets(),
    publicOrigin: await publicOriginView(),
    notificationsPaused: await pausedView(),
  };
}

/** What the System page shows about the public origin: what resolves, and what a browser reported. */
async function publicOriginView(): Promise<AdminSystemData["publicOrigin"]> {
  const { publicOrigin, authEnabled } = getStore();
  if (publicOrigin === undefined) {
    return undefined;
  }
  return {
    resolved: await publicOrigin.resolve(),
    stored: await publicOrigin.stored(),
    // Only a deployment with admins can learn an origin from one.
    learns: authEnabled,
  };
}
