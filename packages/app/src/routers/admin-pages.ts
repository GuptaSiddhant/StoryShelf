import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { AdapterSetupResult, AdapterSetupSources } from "@storyshelf/core/adapter/setup";
import type { Auth } from "@storyshelf/core/auth";
import { ProjectModel } from "@storyshelf/core/models";
import { describeCaptureHost } from "@storyshelf/core/utils";
import type { ShelfRouter } from "../app-types.ts";
import { loadCredentialProbe, reencryptWithCurrent } from "../credentials.ts";
import { countHiddenSnapshots } from "../hidden-data.ts";
import { insightDepsFromStore } from "../insights/deps.ts";
import { buildUsageReport } from "../insights/usage-report.ts";
import { pausedBannerShown } from "../notifications-pause.ts";
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
        ...(await projectFacts(db, testing)),
        ...(await captureView()),
        // Only a host that runs capture jobs (one with `testing`) is sized here.
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

/** The System page's capture browsers and public origin (ADR 0007). */
async function captureView(): Promise<
  Pick<AdminSystemData, "targets" | "publicOrigin" | "notificationsPaused" | "retentionPause">
> {
  return {
    retentionPause: getStore().db.retentionPause,
    targets: await runnerTargets(),
    publicOrigin: await publicOriginView(),
    notificationsPaused: await pausedBannerShown(getStore()),
  };
}

/** What the System page shows about the public origin: what resolves (confirmed), and what a browser reported. */
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

/** Snapshots hidden by hosting-only mode, or the projects that count default-branch claims unverified. */
async function projectFacts(
  db: DatabaseAdapter,
  testing: boolean | undefined,
): Promise<Pick<AdminSystemData, "hiddenSnapshots" | "unverifiedDefault">> {
  return testing
    ? { hiddenSnapshots: 0, unverifiedDefault: await unverifiedDefaultProjects(db) }
    : { hiddenSnapshots: await countHiddenSnapshots(db), unverifiedDefault: [] };
}

/** Projects that turned default-branch verification off (shown on the System page). */
async function unverifiedDefaultProjects(
  db: DatabaseAdapter,
): Promise<{ name: string; slug: string }[]> {
  const projects = await new ProjectModel(db).list();
  return projects
    .filter((project) => project.requireVerifiedDefault === false)
    .map((project) => ({ name: project.name, slug: project.slug }));
}
