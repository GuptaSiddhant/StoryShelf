/**
 * Two-tier health: lightweight liveness (GET, no auth) and deep readiness
 * (POST, site-admin; it also lists each integration's standing, issue #1126, admin-only per #1090). Neither is gated by adapter setup — liveness must
 * answer mid-migration so orchestrators don't kill the machine, and deep
 * reports the setup settlement state instead of being masked by the gate.
 *
 * Probing lives in `health-report.ts` (shared with the admin System page);
 * this module keeps the API response shape stable.
 */
import type { AdapterSetupResult, AdapterSetupSources } from "@storyshelf/core/adapter/setup";
import type { ShelfRouter } from "../app-types.ts";
import { loadCredentialProbe } from "../credentials.ts";
import { getStore, testingEnabled } from "../store.ts";
import { collectHealthReport, type AdapterState } from "./health-report.ts";
import { requireSiteAdmin } from "./helpers.ts";

/** Dependencies for the health routes (no adapter I/O on the GET path). */
export interface HealthDeps {
  sources: AdapterSetupSources;
  getSettled: () => AdapterSetupResult | null;
  bootTimeMs: number;
  version: string;
}

/** Liveness body: process-level only, safe for unauthenticated probes. */
export interface LivenessBody {
  status: "ok";
  uptimeSecs: number;
  version: string;
  /** Whether this instance has the `testing` option (capture, compare, baselines; ADR 0006). */
  testing: boolean;
  /** Whether this instance has an auth adapter; without one every operation is permitted (ADR 0008). */
  auth: boolean;
}

/** Per-adapter readiness entry (error text sanitized — no secrets). */
export interface AdapterReport {
  category: string;
  kind: string;
  name: string;
  state: AdapterState;
  latencyMs?: number;
  detail?: string;
}

/** One integration kind and whether projects are offered it (issue #1126). */
export interface IntegrationReport {
  group: "notifiers" | "design";
  kind: string;
  name: string;
  state: "available" | "unavailable" | "disabled";
  reason?: string;
}

/** Deep readiness body. */
export interface ReadinessBody {
  status: "ok" | "starting" | "degraded";
  adapters: AdapterReport[];
  /** Every integration's standing; informational, it never changes `status`. */
  integrations: IntegrationReport[];
}

/** Register `GET /api/v1/health` (open liveness) and `POST` (authed deep readiness). */
export function registerHealth(app: ShelfRouter, deps: HealthDeps): void {
  app.get("/api/v1/health", (c) => {
    const body: LivenessBody = {
      status: "ok",
      uptimeSecs: Math.floor((Date.now() - deps.bootTimeMs) / 1000),
      version: deps.version,
      testing: testingEnabled(),
      auth: getStore().authEnabled,
    };
    c.header("Cache-Control", "no-store");
    return c.json(body);
  });

  app.post("/api/v1/health", async (c) => {
    requireSiteAdmin(c);
    const { db, config } = getStore();
    const report = await collectHealthReport(
      deps.sources,
      deps.getSettled(),
      deps.bootTimeMs,
      deps.version,
      await loadCredentialProbe(db, config),
    );
    const adapters: AdapterReport[] = report.adapters.map((adapter) => {
      const entry: AdapterReport = {
        category: adapter.category,
        kind: adapter.kind,
        name: adapter.name,
        state: adapter.state,
      };
      if (adapter.latencyMs !== undefined) {
        entry.latencyMs = adapter.latencyMs;
      }
      if (adapter.detail !== undefined) {
        entry.detail = adapter.detail;
      }
      return entry;
    });
    const integrations: IntegrationReport[] = [...(getStore().integrations ?? [])];
    const body: ReadinessBody = { status: report.status, adapters, integrations };
    c.header("Cache-Control", "no-store");
    return c.json(body, body.status === "ok" ? 200 : 503);
  });
}
