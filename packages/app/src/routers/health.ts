/**
 * Two-tier health: lightweight liveness (GET, no auth) and deep readiness
 * (POST, site-admin). Neither is gated by adapter setup — liveness must
 * answer mid-migration so orchestrators don't kill the machine, and deep
 * reports the setup settlement state instead of being masked by the gate.
 *
 * Probing lives in `health-report.ts` (shared with the admin System page);
 * this module keeps the API response shape stable.
 */
import type { AdapterSetupResult, AdapterSetupSources } from "@storyshelf/core/adapter/setup";
import type { ShelfRouter } from "../app-types.ts";
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

/** Deep readiness body. */
export interface ReadinessBody {
  status: "ok" | "starting" | "degraded";
  adapters: AdapterReport[];
}

/** Register `GET /api/v1/health` (open liveness) and `POST` (authed deep readiness). */
export function registerHealth(app: ShelfRouter, deps: HealthDeps): void {
  app.get("/api/v1/health", (c) => {
    const body: LivenessBody = {
      status: "ok",
      uptimeSecs: Math.floor((Date.now() - deps.bootTimeMs) / 1000),
      version: deps.version,
    };
    c.header("Cache-Control", "no-store");
    return c.json(body);
  });

  app.post("/api/v1/health", async (c) => {
    requireSiteAdmin(c);
    const report = await collectHealthReport(
      deps.sources,
      deps.getSettled(),
      deps.bootTimeMs,
      deps.version,
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
    const body: ReadinessBody = { status: report.status, adapters };
    c.header("Cache-Control", "no-store");
    return c.json(body, body.status === "ok" ? 200 : 503);
  });
}
