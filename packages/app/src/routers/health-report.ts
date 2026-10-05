import type {
  AdapterHealth,
  AdapterLifecycle,
  AdapterMetadata,
} from "@storyshelf/core/adapter/metadata";
/**
 * Shared adapter health probing for the JSON API and the admin System page.
 *
 * `POST /api/v1/health` and `GET /admin` both consume
 * {@link collectHealthReport}; the API strips the page-only metadata fields
 * so its response shape never changes. Probes stay parallel, time-bounded,
 * and secret-free (details are truncated, never raw config).
 */
import type { AdapterSetupResult, AdapterSetupSources } from "@storyshelf/core/adapter/setup";
import type { CredentialProbe } from "@storyshelf/core/models";
import { sanitizeErrorText } from "@storyshelf/core/utils";

export type AdapterState = "ok" | "starting" | "failed";

/** Per-adapter readiness entry with identity for the admin page. */
export interface AdapterReportFull {
  category: string;
  kind: string;
  name: string;
  version: string;
  description?: string;
  hasLifecycle: boolean;
  state: AdapterState;
  latencyMs?: number;
  detail?: string;
}

/** Collected health report: overall status plus one entry per adapter. */
export interface HealthReport {
  status: "ok" | "starting" | "degraded";
  uptimeSecs: number;
  version: string;
  adapters: AdapterReportFull[];
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

function pushAll(targets: ProbeTarget[], adapters: ReadonlyArray<ProbeTarget | undefined>): void {
  for (const adapter of adapters) {
    pushTarget(targets, adapter);
  }
}

function targetsOf(sources: AdapterSetupSources): ProbeTarget[] {
  const targets: ProbeTarget[] = [];
  pushAll(targets, [
    sources.database,
    sources.storage,
    sources.captureRunner,
    sources.captureQueue,
  ]);
  pushAll(targets, sources.gitHosts ?? []);
  pushAll(targets, sources.notifiers ?? []);
  pushTarget(targets, sources.emailSender);
  return targets;
}

function sanitize(detail: string): string {
  return sanitizeErrorText(detail, DETAIL_MAX_LENGTH);
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

function baseReport(
  target: ProbeTarget,
): Omit<AdapterReportFull, "state" | "latencyMs" | "detail"> {
  const { category, kind, name, version, description } = target.metadata;
  return {
    category,
    kind,
    name,
    version,
    ...(description === undefined ? {} : { description }),
    hasLifecycle: target.lifecycle?.health !== undefined,
  };
}

function okReport(
  target: ProbeTarget,
  latencyMs: number,
  detail: string | undefined,
): AdapterReportFull {
  return {
    ...baseReport(target),
    state: "ok",
    latencyMs,
    ...(detail === undefined ? {} : { detail }),
  };
}

function failedReport(target: ProbeTarget, latencyMs: number, detail: string): AdapterReportFull {
  return { ...baseReport(target), state: "failed", latencyMs, detail };
}

function setupFailedReport(target: ProbeTarget, detail: string): AdapterReportFull {
  return { ...baseReport(target), state: "failed", detail };
}

function startingReport(target: ProbeTarget): AdapterReportFull {
  return { ...baseReport(target), state: "starting" };
}

function noLifecycleReport(target: ProbeTarget): AdapterReportFull {
  return { ...baseReport(target), state: "ok" };
}

function detailOf(result: AdapterHealth, fallback: string): string {
  return result.detail === undefined ? fallback : sanitize(result.detail);
}

async function raceProbe(
  target: ProbeTarget,
  probe: () => Promise<AdapterHealth>,
  started: number,
): Promise<AdapterReportFull> {
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

async function probeHealth(target: ProbeTarget): Promise<AdapterReportFull> {
  const probe = target.lifecycle?.health;
  if (!probe) {
    return noLifecycleReport(target);
  }
  return await raceProbe(target, probe, Date.now());
}

async function probeTarget(
  target: ProbeTarget,
  setupErrors: ReadonlyMap<string, string>,
  starting: boolean,
): Promise<AdapterReportFull> {
  const setupError = setupErrors.get(`${target.metadata.category}/${target.metadata.kind}`);
  if (setupError !== undefined) {
    return setupFailedReport(target, sanitize(setupError));
  }
  if (starting) {
    return startingReport(target);
  }
  return await probeHealth(target);
}

function collectSetupErrors(settled: AdapterSetupResult | null): ReadonlyMap<string, string> {
  const setupErrors = new Map<string, string>();
  if (settled) {
    for (const failure of settled.failures) {
      setupErrors.set(`${failure.category}/${failure.kind}`, failure.error);
    }
  }
  return setupErrors;
}

function overallStatus(reports: AdapterReportFull[]): HealthReport["status"] {
  if (reports.some((report) => report.state === "failed")) {
    return "degraded";
  }
  if (reports.some((report) => report.state === "starting")) {
    return "starting";
  }
  return "ok";
}

/** Pseudo-adapter entry reporting whether stored credentials decrypt with the configured secret. */
function credentialsEntry(probe: CredentialProbe): AdapterReportFull {
  const unreadable = probe.unreadable.length;
  let detail: string | undefined;
  if (unreadable > 0) {
    detail = `${unreadable} stored credential(s) cannot be decrypted; check SECRET and SECRET_PREVIOUS`;
  } else if (probe.previous > 0) {
    detail = `${probe.previous} credential(s) still encrypted with the previous secret; re-encrypt from the System page`;
  }
  return {
    category: "credentials",
    kind: "secret",
    name: "Credential encryption",
    version: "-",
    hasLifecycle: false,
    state: unreadable > 0 ? "failed" : "ok",
    ...(detail === undefined ? {} : { detail }),
  };
}

/**
 * Probe every wired adapter and assemble the full health report.
 *
 * @param sources - Live adapter instances to probe.
 * @param settled - Setup settlement (null while the eager run is in flight).
 * @param bootTimeMs - Process boot timestamp for uptime.
 * @param version - Server version for the report header.
 * @param credentials - Stored-credential probe (omit when no secret is configured).
 */
export async function collectHealthReport(
  sources: AdapterSetupSources,
  settled: AdapterSetupResult | null,
  bootTimeMs: number,
  version: string,
  credentials?: CredentialProbe | null,
): Promise<HealthReport> {
  const setupErrors = collectSetupErrors(settled);
  const targets = targetsOf(sources);
  const adapters = await Promise.all(
    targets.map(async (target) => await probeTarget(target, setupErrors, settled === null)),
  );
  if (credentials) {
    adapters.push(credentialsEntry(credentials));
  }
  return {
    status: overallStatus(adapters),
    uptimeSecs: Math.floor((Date.now() - bootTimeMs) / 1000),
    version,
    adapters,
  };
}
