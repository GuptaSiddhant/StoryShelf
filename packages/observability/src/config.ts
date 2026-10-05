/**
 * Environment-driven observability configuration.
 *
 * Standard `OTEL_*` variables win; `STORYSHELF_OTEL_*` covers StoryShelf
 * specifics. When `OTEL_EXPORTER_OTLP_ENDPOINT` is unset the SDK stays a
 * noop (zero overhead, hermetic tests). Deno runtimes are always noop here —
 * Deno's built-in OTEL (`OTEL_DENO=true`) bridges `npm:@opentelemetry/api`
 * natively, so a NodeSDK must never start under Deno.
 */

/** Resolved observability configuration for the Node SDK entrypoint. */
export interface ObservabilityConfig {
  /** Whether to start the SDK (false = noop handle). */
  enabled: boolean;
  /** OTLP/HTTP endpoint, e.g. `http://collector:4318`. */
  endpoint?: string;
  /** Extra OTLP headers (`OTEL_EXPORTER_OTLP_HEADERS`, `k=v,k2=v2`). */
  headers?: Record<string, string>;
  /** Resource `service.name`. */
  serviceName: string;
  /** Resource `service.version`. */
  serviceVersion?: string;
  /** Metric export interval in milliseconds. */
  metricsIntervalMs: number;
}

const DEFAULT_SERVICE_NAME = "storyshelf";
const DEFAULT_METRICS_INTERVAL_MS = 60_000;

/** Whether the current runtime is Deno (native OTEL owns the SDK there). */
function isDenoRuntime(env: NodeJS.ProcessEnv): boolean {
  if (env["OTEL_DENO"] === "true") {
    return true;
  }
  return (globalThis as { Deno?: unknown }).Deno !== undefined;
}

/** Parse one `k=v` pair into the headers record. */
function parseHeaderPair(pair: string, headers: Record<string, string>): void {
  const separator = pair.indexOf("=");
  if (separator === -1) {
    return;
  }
  const key = pair.slice(0, separator).trim();
  const value = pair.slice(separator + 1).trim();
  if (key) {
    headers[key] = value;
  }
}

/** Parse `k=v,k2=v2` header syntax into a record. */
function parseHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) {
    return undefined;
  }
  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    parseHeaderPair(pair, headers);
  }
  return Object.keys(headers).length === 0 ? undefined : headers;
}

/** Parse a positive integer env value with a fallback. */
function parseInterval(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!raw || !Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

/**
 * Resolve the observability configuration from the environment.
 *
 * @param env - Environment record (defaults to `process.env`).
 * @param serviceVersion - Version for the resource (defaults to `__PKG_VERSION__`).
 * @returns The resolved config; `enabled` is false without an endpoint.
 */
export function resolveObservabilityConfig(
  env: NodeJS.ProcessEnv = process.env,
  serviceVersion?: string,
): ObservabilityConfig {
  const endpoint = env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  const sdkDisabled = env["OTEL_SDK_DISABLED"] === "true";
  const explicit = env["STORYSHELF_OTEL_ENABLED"];
  const enabled =
    !sdkDisabled && !isDenoRuntime(env) && (explicit ? explicit === "true" : Boolean(endpoint));
  return {
    enabled,
    endpoint,
    headers: parseHeaders(env["OTEL_EXPORTER_OTLP_HEADERS"]),
    serviceName: env["OTEL_SERVICE_NAME"] ?? DEFAULT_SERVICE_NAME,
    serviceVersion: serviceVersion ?? packageVersion(),
    metricsIntervalMs: parseInterval(
      env["STORYSHELF_OTEL_METRICS_INTERVAL_MS"],
      DEFAULT_METRICS_INTERVAL_MS,
    ),
  };
}

/** Package version injected at build via __PKG_VERSION__. */
function packageVersion(): string | undefined {
  return (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__;
}
