import { afterEach, describe, expect, it } from "vitest";
import { otelLogMixin } from "./logs.ts";
import { installTestTelemetry, type TestTelemetry } from "./test-setup.ts";
import { withSpan } from "./tracing.ts";

describe("otelLogMixin", () => {
  let telemetry: TestTelemetry | undefined;

  afterEach(async () => {
    await telemetry?.cleanup();
    telemetry = undefined;
  });

  it("returns no fields without an active span", () => {
    expect(otelLogMixin()).toEqual({});
  });

  it("injects trace_id and span_id inside a span", async () => {
    telemetry = installTestTelemetry();
    let fields: Record<string, string> = {};
    await withSpan("test.logging", async () => {
      fields = otelLogMixin();
      expect(fields["trace_id"]).toMatch(/^[0-9a-f]{32}$/u);
      expect(fields["span_id"]).toMatch(/^[0-9a-f]{16}$/u);
    });
    const spans = telemetry?.exporter.getFinishedSpans() ?? [];
    expect(spans).toHaveLength(1);
    expect(fields["trace_id"]).toBe(spans[0]?.spanContext().traceId);
    expect(fields["span_id"]).toBe(spans[0]?.spanContext().spanId);
  });
});
