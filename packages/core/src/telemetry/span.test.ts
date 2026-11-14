import { SpanStatusCode } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";
import { HttpError } from "../utils/index.ts";
import { withSpan } from "./span.ts";
import { installTestTelemetry, type TestTelemetry } from "./test-setup.ts";

describe("withSpan", () => {
  let telemetry: TestTelemetry | undefined;

  afterEach(async () => {
    await telemetry?.cleanup();
    telemetry = undefined;
  });

  async function recorded(thrown: unknown) {
    telemetry = installTestTelemetry();
    const caught = await withSpan("test.secret", async () => {
      await Promise.resolve();
      throw thrown;
    }).catch((error: unknown) => error);
    const [span] = telemetry.exporter.getFinishedSpans();
    const event = span?.events.find((item) => item.name === "exception");
    return { caught, attributes: JSON.stringify(event?.attributes ?? {}) };
  }

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
  describe("recorded exceptions", () => {
    const PASSWORD = "secretpw";
    const KEY = "ghp_AbCdEf0123456789AbCdEf0123456789";

    it("records neither a connection-string password nor an API key, and rethrows the original", async () => {
      const original = new Error(`connect postgres://u:${PASSWORD}@h/db failed, token ${KEY}`);
      const { caught, attributes } = await recorded(original);
      expect(caught).toBe(original);
      expect(original.message).toContain(PASSWORD);
      expect(attributes).not.toContain(PASSWORD);
      expect(attributes).not.toContain(KEY);
      expect(attributes).toContain("connect postgres://");
    });

    it("keeps the error name and redacts secrets in the stack too", async () => {
      const original = new TypeError(`bad ${KEY}`);
      original.stack = `TypeError: bad ${KEY}\n    at apikey=${PASSWORD} (file.ts:1:1)`;
      const { attributes } = await recorded(original);
      expect(attributes).toContain("TypeError");
      expect(attributes).not.toContain(KEY);
      expect(attributes).not.toContain(PASSWORD);
    });

    it("records only the status of an HttpError, never its body", async () => {
      const { caught, attributes } = await recorded(
        new HttpError(502, `upstream said https://u:${PASSWORD}@h/x?token=abc`),
      );
      expect(caught).toBeInstanceOf(HttpError);
      expect(attributes).toContain("HTTP 502");
      expect(attributes).not.toContain(PASSWORD);
      expect(attributes).not.toContain("upstream said");
    });

    it("redacts a thrown non-error value", async () => {
      const { caught, attributes } = await recorded(`oops ${KEY}`);
      expect(caught).toBe(`oops ${KEY}`);
      expect(attributes).not.toContain(KEY);
    });
  });
});
