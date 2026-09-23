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
