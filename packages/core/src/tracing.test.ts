import { describe, expect, it } from "vitest";
import { currentTraceparent, injectTraceContext, parentContext, withSpan } from "./tracing.ts";

describe("core tracing helpers", () => {
  it("passes the callback value through without a provider", async () => {
    const result = await withSpan("test.noop", async (span) => {
      expect(span).toBeDefined();
      return "ok";
    });
    expect(result).toBe("ok");
  });

  it("rethrows callback errors without a provider", async () => {
    await expect(
      withSpan("test.failing", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("returns undefined traceparent without an active span", () => {
    expect(currentTraceparent()).toBeUndefined();
  });

  it("injects nothing without an active span", () => {
    const headers: Record<string, string> = {};
    injectTraceContext(headers);
    expect(headers).toEqual({});
  });

  it("keeps the active context without a traceparent", async () => {
    await withSpan("test.context", async () => {
      expect(parentContext()).toBeDefined();
    });
  });
});
