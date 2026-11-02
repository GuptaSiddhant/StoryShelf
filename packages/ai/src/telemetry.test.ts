import { HttpError } from "@storyshelf/core/utils";
import { afterEach, describe, expect, it } from "vitest";
import { withSpan } from "./telemetry.ts";
import { installTestTelemetry } from "./test-support.ts";

describe("withSpan recorded exceptions", () => {
  const PASSWORD = "secretpw";
  const KEY = "ghp_AbCdEf0123456789AbCdEf0123456789";
  let telemetry: ReturnType<typeof installTestTelemetry> | undefined;

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

  it("records neither a connection-string password nor an API key, and rethrows the original", async () => {
    const original = new Error(`provider failed postgres://u:${PASSWORD}@h/db, key ${KEY}`);
    const { caught, attributes } = await recorded(original);
    expect(caught).toBe(original);
    expect(original.message).toContain(PASSWORD);
    expect(attributes).not.toContain(PASSWORD);
    expect(attributes).not.toContain(KEY);
    expect(attributes).toContain("provider failed");
  });

  it("keeps the error name and redacts secrets in the stack too", async () => {
    const original = new TypeError(`bad ${KEY}`);
    original.stack = `TypeError: bad ${KEY}\n    at apikey=${PASSWORD} (file.ts:1:1)`;
    const { attributes } = await recorded(original);
    expect(attributes).toContain("TypeError");
    expect(attributes).not.toContain(KEY);
    expect(attributes).not.toContain(PASSWORD);
  });

  it("records only the status of an HttpError, never the provider's response text", async () => {
    const { caught, attributes } = await recorded(
      new HttpError(429, `provider body echoing ${KEY} and https://u:${PASSWORD}@h/x`),
    );
    expect(caught).toBeInstanceOf(HttpError);
    expect(attributes).toContain("HTTP 429");
    expect(attributes).not.toContain(KEY);
    expect(attributes).not.toContain("provider body");
  });

  it("redacts a thrown non-error value", async () => {
    const { caught, attributes } = await recorded(`oops ${KEY}`);
    expect(caught).toBe(`oops ${KEY}`);
    expect(attributes).not.toContain(KEY);
  });
});
