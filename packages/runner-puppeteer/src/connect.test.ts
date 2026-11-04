import { describe, expect, it } from "vitest";
import { reasonOf } from "./connect.ts";

describe("reasonOf", () => {
  const connection = {
    endpoint: "wss://farm.example/tenant-7?key=sekret-key",
    headers: { authorization: "Bearer sekret-token" },
  };

  it("keeps what a WebSocket error event says, never [object Object]", () => {
    const event = { type: "error", error: new Error("connect ECONNREFUSED 10.0.0.9:9222") };
    expect(reasonOf(event, connection)).toBe("connect ECONNREFUSED 10.0.0.9:9222");
    expect(reasonOf({ type: "close", code: 1006, reason: "" }, connection)).toBe(
      "close event (code 1006)",
    );
    expect(reasonOf({}, connection)).toBe("unknown error");
    expect(reasonOf("plain text", connection)).toBe("plain text");
  });

  it("adds the cause of an Error, such as the failure behind `fetch failed`", () => {
    const error = new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
    expect(reasonOf(error, connection)).toBe("fetch failed: connect ECONNREFUSED");
  });

  it("scrubs the endpoint before cutting a long message, so no half of it is left", () => {
    const long = `${"x".repeat(470)} ${connection.endpoint} ${"y".repeat(100)}`;
    const text = reasonOf(new Error(long), connection);
    expect(text.length).toBeLessThanOrEqual(500);
    expect(text).not.toMatch(/farm|sekret|tenant/u);
  });

  it("removes the endpoint, its credentials and header values from any shape", () => {
    const text = reasonOf(
      { message: `cannot reach ${connection.endpoint} with Bearer sekret-token` },
      connection,
    );
    expect(text).not.toContain("sekret");
    expect(text).not.toContain("farm.example");
    expect(
      reasonOf(
        new Error(`handshake to ${connection.endpoint} failed`, {
          cause: { message: "token=abc123 refused" },
        }),
        connection,
      ),
    ).not.toMatch(/sekret|abc123/u);
  });
});
