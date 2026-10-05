import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";
import {
  currentTraceparent,
  injectTraceContext,
  parentContext,
  TRACEPARENT_HEADER,
} from "./propagate.ts";
import { installTestTelemetry, type TestTelemetry } from "./test-setup.ts";
import { withSpan } from "./tracing.ts";

describe("trace propagation", () => {
  let telemetry: TestTelemetry | undefined;

  afterEach(async () => {
    await telemetry?.cleanup();
    telemetry = undefined;
  });

  it("returns undefined without an active span", () => {
    expect(currentTraceparent()).toBeUndefined();
  });

  it("round-trips the traceparent through parentContext", async () => {
    telemetry = installTestTelemetry();
    await withSpan("test.parent", async () => {
      const header = currentTraceparent();
      expect(header).toMatch(/^00-/u);
      const headers: Record<string, string> = {};
      injectTraceContext(headers);
      expect(headers[TRACEPARENT_HEADER]).toBe(header);
      const extracted = trace.getSpanContext(parentContext(header));
      const active = trace.getSpanContext(parentContext());
      expect(extracted?.traceId).toBeDefined();
      expect(extracted?.traceId).toBe(active?.traceId);
    });
  });
});
