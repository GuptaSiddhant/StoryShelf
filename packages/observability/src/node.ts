/**
 * Node-only OTEL SDK lifecycle.
 *
 * Separate entrypoint (`@storyshelf/observability/node`) so the cross-runtime
 * root never pulls Node SDK modules. Never import this file under Deno —
 * `initObservabilityFromEnv` noops there and Deno's native OTEL owns export.
 */
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { resolveObservabilityConfig, type ObservabilityConfig } from "./config.ts";
import type { ObservabilityHandle } from "./types.ts";

/** Noop handle: SDK disabled, nothing to flush. */
function noopHandle(): ObservabilityHandle {
  return {
    enabled: false,
    shutdown: async (): Promise<void> => {
      await Promise.resolve();
    },
  };
}

/** OTLP/HTTP exporter options shared by trace and metric exporters. */
function exporterOptions(config: ObservabilityConfig): {
  url?: string;
  headers?: Record<string, string>;
} {
  return {
    url: config.endpoint ? `${config.endpoint}/v1/traces` : undefined,
    headers: config.headers,
  };
}

/** Start the Node SDK wired to the OTLP/HTTP endpoint. */
function startSdk(config: ObservabilityConfig): ObservabilityHandle {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    ...(config.serviceVersion ? { [ATTR_SERVICE_VERSION]: config.serviceVersion } : {}),
    ...(process.env["NODE_ENV"]
      ? { [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env["NODE_ENV"] }
      : {}),
  });
  const sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter(exporterOptions(config)),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: config.endpoint ? `${config.endpoint}/v1/metrics` : undefined,
          headers: config.headers,
        }),
        exportIntervalMillis: config.metricsIntervalMs,
      }),
    ],
  });
  sdk.start();
  let shut = false;
  return {
    enabled: true,
    shutdown: async (): Promise<void> => {
      if (shut) {
        return;
      }
      shut = true;
      await sdk.shutdown();
    },
  };
}

/**
 * Initialize observability from the environment.
 *
 * Starts the Node SDK when `OTEL_EXPORTER_OTLP_ENDPOINT` (or
 * `STORYSHELF_OTEL_ENABLED=true`) is set; otherwise returns a noop handle
 * (also under Deno or `OTEL_SDK_DISABLED=true`). Call before
 * `createShelfApp` and flush via the handle next to `app.lifecycle.teardown`.
 *
 * @param env - Environment record (defaults to `process.env`).
 * @returns The SDK handle (check `enabled`, always call `shutdown`).
 */
// oxlint-disable-next-line typescript/require-await -- async signature; the disabled fast-path is synchronous
export async function initObservabilityFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ObservabilityHandle> {
  const config = resolveObservabilityConfig(env);
  if (!config.enabled) {
    return noopHandle();
  }
  return startSdk(config);
}

export { resolveObservabilityConfig } from "./config.ts";
export type { ObservabilityConfig } from "./config.ts";
export type { ObservabilityHandle } from "./types.ts";
