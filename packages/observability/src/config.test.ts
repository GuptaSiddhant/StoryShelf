import { afterEach, describe, expect, it } from "vitest";
import { resolveObservabilityConfig } from "./config.ts";

describe("resolveObservabilityConfig", () => {
  it("is disabled without an endpoint", () => {
    const config = resolveObservabilityConfig({});
    expect(config.enabled).toBe(false);
    expect(config.serviceName).toBe("storyshelf");
    expect(config.metricsIntervalMs).toBe(60_000);
  });

  it("enables with an OTLP endpoint", () => {
    const config = resolveObservabilityConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
    });
    expect(config.enabled).toBe(true);
    expect(config.endpoint).toBe("http://collector:4318");
  });

  it("honors OTEL_SDK_DISABLED", () => {
    const config = resolveObservabilityConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
      OTEL_SDK_DISABLED: "true",
    });
    expect(config.enabled).toBe(false);
  });

  it("supports explicit STORYSHELF_OTEL_ENABLED", () => {
    expect(resolveObservabilityConfig({ STORYSHELF_OTEL_ENABLED: "true" }).enabled).toBe(true);
    expect(
      resolveObservabilityConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
        STORYSHELF_OTEL_ENABLED: "false",
      }).enabled,
    ).toBe(false);
  });

  it("stays noop under Deno", () => {
    const deno = (globalThis as { Deno?: unknown }).Deno;
    (globalThis as { Deno?: unknown }).Deno = {};
    try {
      const config = resolveObservabilityConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://x:4318" });
      expect(config.enabled).toBe(false);
    } finally {
      if (deno === undefined) {
        delete (globalThis as { Deno?: unknown }).Deno;
      } else {
        (globalThis as { Deno?: unknown }).Deno = deno;
      }
    }
    expect(
      resolveObservabilityConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://x:4318",
        OTEL_DENO: "true",
      }).enabled,
    ).toBe(false);
  });

  it("parses headers, service name, and interval", () => {
    const config = resolveObservabilityConfig(
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
        OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer abc, x-tenant = t1",
        OTEL_SERVICE_NAME: "shelf-prod",
        STORYSHELF_OTEL_METRICS_INTERVAL_MS: "15000",
      },
      "1.2.3",
    );
    expect(config.headers).toEqual({ authorization: "Bearer abc", "x-tenant": "t1" });
    expect(config.serviceName).toBe("shelf-prod");
    expect(config.serviceVersion).toBe("1.2.3");
    expect(config.metricsIntervalMs).toBe(15_000);
  });

  it("falls back on malformed headers and intervals", () => {
    const config = resolveObservabilityConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
      OTEL_EXPORTER_OTLP_HEADERS: "no-equals-here",
      STORYSHELF_OTEL_METRICS_INTERVAL_MS: "banana",
    });
    expect(config.headers).toBeUndefined();
    expect(config.metricsIntervalMs).toBe(60_000);
  });

  afterEach(() => {
    delete process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  });
});
