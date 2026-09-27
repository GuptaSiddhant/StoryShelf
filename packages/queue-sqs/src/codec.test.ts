/** MessageBody serialization tests for the SQS capture queue. */
import { describe, expect, it } from "vitest";
import { parseBody, serializeEnqueueBody } from "./codec.ts";

describe("serializeEnqueueBody", () => {
  it("serializes buildId, reqId, status, and queuedAt", () => {
    const body = JSON.parse(serializeEnqueueBody({ buildId: "build-1", reqId: "req-1" })) as Record<
      string,
      unknown
    >;

    expect(body["buildId"]).toBe("build-1");
    expect(body["reqId"]).toBe("req-1");
    expect(body["status"]).toBe("queued");
    expect(typeof body["queuedAt"]).toBe("string");
  });

  it("round-trips the traceparent", () => {
    const raw = serializeEnqueueBody({
      buildId: "build-1",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });
    expect(parseBody(raw).traceparent).toBe(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    );
  });
});

describe("parseBody", () => {
  it("parses a valid queued body", () => {
    expect(parseBody(JSON.stringify({ buildId: "b1", status: "queued" }))).toEqual({
      buildId: "b1",
      status: "queued",
    });
  });

  it("returns empty on malformed JSON", () => {
    expect(parseBody("not-json")).toEqual({});
  });

  it("returns empty on an empty body", () => {
    expect(parseBody("")).toEqual({});
  });
});
