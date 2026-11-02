import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordSpans } from "./test-helpers/span-recorder.ts";
import {
  currentTraceparent,
  injectTraceContext,
  parentContext,
  setSpanMessage,
  withSpan,
} from "./tracing.ts";

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

/** Fail a span with `error` and return whatever `withSpan` rethrew. */
async function failWith(error: unknown): Promise<unknown> {
  try {
    await withSpan("test.failing", async () => {
      await Promise.resolve();
      throw error;
    });
    return undefined;
  } catch (caught) {
    return caught;
  }
}

describe("exceptions recorded on a span", () => {
  let recorder: ReturnType<typeof recordSpans>;
  beforeEach(() => {
    recorder = recordSpans();
  });
  afterEach(() => {
    recorder.stop();
  });

  it("records a redacted copy of the same name and rethrows the original object untouched", async () => {
    const original = new Error("connect failed postgres://user:hunter2@db.example/app");
    original.name = "ConnectError";
    const thrown = await failWith(original);
    expect(thrown).toBe(original);
    expect(original.message).toContain("hunter2");
    const [span] = recorder.spans;
    expect(span?.exceptions).toHaveLength(1);
    expect(span?.exceptions[0]?.name).toBe("ConnectError");
    expect(span?.exceptions[0]?.message).toContain("[redacted]");
    expect(JSON.stringify(span)).not.toContain("hunter2");
    expect(span?.status?.code).toBe(2);
    expect(span?.ended).toBe(true);
  });

  it("records what setSpanMessage says instead of the message, in the message and the stack header", async () => {
    const original = new Error("HTTP 500: the body echoed SECRET-BODY");
    setSpanMessage(original, "HTTP 500");
    expect(await failWith(original)).toBe(original);
    const [exception] = recorder.spans[0]?.exceptions ?? [];
    expect(exception?.message).toBe("HTTP 500");
    expect(exception?.stack).toMatch(/^Error: HTTP 500/u);
    expect(JSON.stringify(recorder.spans)).not.toContain("SECRET-BODY");
    expect(original.message).toContain("SECRET-BODY");
  });

  it("keeps the original's frames, and drops its cause", async () => {
    const original = new Error("outer", { cause: new Error("SECRET-CAUSE") });
    await failWith(original);
    const [exception] = recorder.spans[0]?.exceptions ?? [];
    expect(exception?.stack).toContain("tracing.test.ts");
    expect(JSON.stringify(recorder.spans)).not.toContain("SECRET-CAUSE");
  });

  it("redacts a thrown non-error and ignores a span message set on one", async () => {
    setSpanMessage("not an object", "ignored");
    expect(await failWith("api_key=sk-12345 leaked")).toBe("api_key=sk-12345 leaked");
    const [exception] = recorder.spans[0]?.exceptions ?? [];
    expect(exception?.message).toContain("[redacted]");
    expect(JSON.stringify(recorder.spans)).not.toContain("sk-12345");
  });
});
