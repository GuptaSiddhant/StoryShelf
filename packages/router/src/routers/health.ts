/**
 * Two-tier health: lightweight liveness (GET, no auth) and deep readiness
 * (POST, site-admin). Neither is gated by adapter init — liveness must
 * answer mid-migration so orchestrators don't kill the machine, and deep
 * reports the init settlement state instead of being masked by the gate.
 */
import type { AdapterInitResult, AdapterInitSources } from "@storyshelf/core/adapter/init";
import type {
  AdapterHealth,
  AdapterLifecycle,
  AdapterMetadata,
} from "@storyshelf/core/adapter/metadata";
import type { ShelfApp } from "../index.tsx";
import { requireSiteAdmin } from "./helpers.ts";

/** Dependencies for the health routes (no adapter I/O on the GET path). */
export interface HealthDeps {
  sources: AdapterInitSources;
  getSettled: () => AdapterInitResult | null;
  bootTimeMs: number;
  version: string;
}

/** Liveness body: process-level only, safe for unauthenticated probes. */
export interface LivenessBody {
  status: "ok";
  uptimeSecs: number;
  version: string;
}

type AdapterState = "ok" | "starting" | "failed";

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

interface ProbeTarget {
  readonly metadata: AdapterMetadata;
  readonly lifecycle?: AdapterLifecycle;
}

const PROBE_TIMEOUT_MS = 2000;
const DETAIL_MAX_LENGTH = 500;

function pushTarget(targets: ProbeTarget[], adapter: ProbeTarget | undefined): void {
  if (adapter) {
    targets.push(adapter);
  }
}

function targetsOf(sources: AdapterInitSources): ProbeTarget[] {
  const targets: ProbeTarget[] = [];
  pushTarget(targets, sources.database);
  pushTarget(targets, sources.storage);
  pushTarget(targets, sources.captureRunner);
  pushTarget(targets, sources.captureQueue);
  pushTarget(targets, sources.auth);
  for (const provider of sources.gitHosts ?? []) {
    pushTarget(targets, provider);
  }
  return targets;
}

function sanitize(detail: string): string {
  return detail.length > DETAIL_MAX_LENGTH ? detail.slice(0, DETAIL_MAX_LENGTH) : detail;
}

function messageOf(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  return sanitize(message);
}

async function timeoutError(): Promise<never> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, PROBE_TIMEOUT_MS);
  });
  throw new Error("health probe timed out");
}

function okReport(
  target: ProbeTarget,
  latencyMs: number,
  detail: string | undefined,
): AdapterReport {
  const { category, kind, name } = target.metadata;
  return {
    category,
    kind,
    name,
    state: "ok",
    latencyMs,
    ...(detail === undefined ? {} : { detail }),
  };
}

function failedReport(target: ProbeTarget, latencyMs: number, detail: string): AdapterReport {
  const { category, kind, name } = target.metadata;
  return { category, kind, name, state: "failed", latencyMs, detail };
}

function detailOf(result: AdapterHealth, fallback: string): string {
  return result.detail === undefined ? fallback : sanitize(result.detail);
}

async function raceProbe(
  target: ProbeTarget,
  probe: () => Promise<AdapterHealth>,
  started: number,
): Promise<AdapterReport> {
  try {
    const result = await Promise.race([probe(), timeoutError()]);
    const latencyMs = Date.now() - started;
    if (!result.ok) {
      return failedReport(target, latencyMs, detailOf(result, "probe reported failure"));
    }
    return okReport(
      target,
      latencyMs,
      result.detail === undefined ? undefined : sanitize(result.detail),
    );
  } catch (error) {
    return failedReport(target, Date.now() - started, messageOf(error));
  }
}

async function probeHealth(target: ProbeTarget): Promise<AdapterReport> {
  const probe = target.lifecycle?.health;
  if (!probe) {
    const { category, kind, name } = target.metadata;
    return { category, kind, name, state: "ok" };
  }
  return await raceProbe(target, probe, Date.now());
}

async function probeTarget(
  target: ProbeTarget,
  initErrors: ReadonlyMap<string, string>,
  starting: boolean,
): Promise<AdapterReport> {
  const { category, kind, name } = target.metadata;
  const initError = initErrors.get(`${category}/${kind}`);
  if (initError !== undefined) {
    return { category, kind, name, state: "failed", detail: sanitize(initError) };
  }
  if (starting) {
    return { category, kind, name, state: "starting" };
  }
  return await probeHealth(target);
}

function collectInitErrors(settled: AdapterInitResult | null): ReadonlyMap<string, string> {
  const initErrors = new Map<string, string>();
  if (settled) {
    for (const failure of settled.failures) {
      initErrors.set(`${failure.category}/${failure.kind}`, failure.error);
    }
  }
  return initErrors;
}

function overallStatus(reports: AdapterReport[]): ReadinessBody["status"] {
  if (reports.some((report) => report.state === "failed")) {
    return "degraded";
  }
  if (reports.some((report) => report.state === "starting")) {
    return "starting";
  }
  return "ok";
}

/** Register `GET /api/v1/health` (open liveness) and `POST` (authed deep readiness). */
export function registerHealth(app: ShelfApp, deps: HealthDeps): void {
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
    requireSiteAdmin();
    const settled = deps.getSettled();
    const initErrors = collectInitErrors(settled);
    const targets = targetsOf(deps.sources);
    const reports = await Promise.all(
      targets.map(async (target) => await probeTarget(target, initErrors, settled === null)),
    );
    const body: ReadinessBody = { status: overallStatus(reports), adapters: reports };
    c.header("Cache-Control", "no-store");
    return c.json(body, body.status === "ok" ? 200 : 503);
  });
}
