import { SpanStatusCode } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";
import { installTestTelemetry, type TestTelemetry } from "./test-setup.ts";
import { withSpan } from "./tracing.ts";

describe("withSpan", () => {
  let telemetry: TestTelemetry | undefined;

  afterEach(async () => {
    await telemetry?.cleanup();
    telemetry = undefined;
  });

  it("returns the callback value with attributes", async () => {
    telemetry = installTestTelemetry();
    const result = await withSpan(
      "test.operation",
      async (span) => {
        span.setAttribute("extra", "yes");
        return 42;
      },
      { "test.attr": "value" },
    );
    expect(result).toBe(42);
    const spans = telemetry.exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe("test.operation");
    expect(spans[0]?.attributes["test.attr"]).toBe("value");
    expect(spans[0]?.attributes["extra"]).toBe("yes");
  });

  it("marks ERROR and rethrows", async () => {
    telemetry = installTestTelemetry();
    await expect(
      withSpan("test.failing", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const spans = telemetry.exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0]?.events.some((event) => event.name === "exception")).toBe(true);
  });

  it("is a noop-safe passthrough without a provider", async () => {
    const result = await withSpan("test.noop", async () => "ok");
    expect(result).toBe("ok");
  });
});
