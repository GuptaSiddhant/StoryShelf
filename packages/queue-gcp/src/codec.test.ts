/** Serialization and path-helper tests for the Pub/Sub queue. */
import { describe, expect, it } from "vitest";
import {
  decodeData,
  encodeData,
  parseBody,
  serializeBody,
  subscriptionPath,
  topicPath,
} from "./codec.ts";

describe("topicPath/subscriptionPath", () => {
  it("builds fully-qualified resource paths", () => {
    expect(topicPath("acme-shelf", "capture-jobs")).toBe("projects/acme-shelf/topics/capture-jobs");
    expect(subscriptionPath("acme-shelf", "capture-jobs-worker")).toBe(
      "projects/acme-shelf/subscriptions/capture-jobs-worker",
    );
  });
});

describe("serializeBody/parseBody", () => {
  it("round-trips a job body with queued status", () => {
    const raw = serializeBody({ buildId: "build-1", reqId: "req-1" });

    const body = parseBody(raw);

    expect(body.buildId).toBe("build-1");
    expect(body.reqId).toBe("req-1");
    expect(body.status).toBe("queued");
    expect(typeof body.queuedAt).toBe("string");
  });

  it("returns empty for malformed JSON", () => {
    expect(parseBody("not-json")).toEqual({});
  });

  it("returns empty for null and non-object bodies", () => {
    expect(parseBody("null")).toEqual({});
    expect(parseBody("42")).toEqual({});
  });
});

describe("encodeData/decodeData", () => {
  it("round-trips text through bytes", () => {
    const body = JSON.stringify({ buildId: "build-1" });

    expect(decodeData(encodeData(body))).toBe(body);
  });

  it("passes string payloads through unchanged", () => {
    expect(decodeData("raw-body")).toBe("raw-body");
  });
});
