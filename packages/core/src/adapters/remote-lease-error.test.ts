import { describe, expect, it } from "vitest";
import {
  RemoteConnectError,
  classify,
  connectErrorOf,
  stoppedError,
} from "./remote-lease-error.ts";

describe("classify", () => {
  it("retries a provider error unless it says transient: false", () => {
    expect(classify(new RemoteConnectError("x"))).toEqual({ retry: true, unavailable: false });
    expect(classify(new RemoteConnectError("x", { transient: false }))).toEqual({
      retry: false,
      unavailable: true,
    });
  });

  it("keeps the target offered for a permanent error scoped to the job", () => {
    expect(classify(new RemoteConnectError("x", { transient: false, scope: "job" }))).toEqual({
      retry: false,
      unavailable: false,
    });
  });

  it("never retries a stopped connect, and does not blame the target", () => {
    expect(classify(stoppedError())).toEqual({ retry: false, unavailable: false });
  });

  it("classifies a handshake error by its text", () => {
    expect(classify(new Error("connect ECONNREFUSED"))).toEqual({
      retry: true,
      unavailable: false,
    });
    expect(classify(new Error("401 Unauthorized"))).toEqual({ retry: false, unavailable: true });
  });
});

describe("connectErrorOf", () => {
  it("wraps a thrown error, reading transient, scope and lease off it", () => {
    const wrapped = connectErrorOf(
      Object.assign(new Error("gone"), { transient: false, scope: "job", lease: { id: 1 } }),
    );
    expect(wrapped).toBeInstanceOf(RemoteConnectError);
    expect(wrapped.message).toBe("acquire failed: gone");
    expect(wrapped).toMatchObject({ transient: false, scope: "job", lease: { id: 1 } });
  });

  it("treats a thrown non-error as transient text", () => {
    expect(connectErrorOf("boom")).toMatchObject({
      message: "acquire failed: boom",
      transient: true,
    });
    expect(connectErrorOf(null).scope).toBe("target");
  });

  it("keeps what an event object says instead of [object Object]", () => {
    const wrapped = connectErrorOf({ type: "error", error: new Error("connect ECONNREFUSED") });
    expect(wrapped.message).toBe("acquire failed: connect ECONNREFUSED");
    expect(connectErrorOf({}).message).toBe("acquire failed: unknown error");
  });

  it("cuts a URL in the provider's text to its origin", () => {
    const wrapped = connectErrorOf(
      new Error("connect to wss://farm.example.com/session/abc123?token=s3cr3t failed"),
    );
    expect(wrapped.message).toBe("acquire failed: connect to wss://farm.example.com failed");
  });

  it("redacts a Bearer or Basic header value and a secret shape in the text", () => {
    const bearer = connectErrorOf(new Error("401 with Authorization: Bearer abcdef1234567890"));
    expect(bearer.message).toBe("acquire failed: 401 with Authorization: Bearer [redacted]");
    expect(connectErrorOf("sent Basic dXNlcjpwYXNzd29yZA== to farm").message).toBe(
      "acquire failed: sent Basic [redacted] to farm",
    );
    expect(connectErrorOf(new Error("failed, api_key=hunter2hunter2")).message).toBe(
      "acquire failed: failed, api_key=[redacted]",
    );
  });

  it("cuts a URL whose query value is quoted, so the quoted value goes with it", () => {
    const wrapped = connectErrorOf(
      new Error("connect to wss://farm.example.com/?token='secret123' failed"),
    );
    expect(wrapped.message).not.toContain("secret123");
    expect(wrapped.message).toContain("wss://farm.example.com");
  });

  it("redacts a short credential named by an Authorization header, and one with digits or symbols", () => {
    // `a:b` encodes to `YTpi`.
    expect(connectErrorOf(new Error("sent Authorization: Basic YTpi")).message).toBe(
      "acquire failed: sent Authorization: Basic [redacted]",
    );
    expect(connectErrorOf(new Error("sent authorization=Bearer ab")).message).toBe(
      "acquire failed: sent authorization=Bearer [redacted]",
    );
    expect(connectErrorOf(new Error("got Bearer 1234 back")).message).toBe(
      "acquire failed: got Bearer [redacted] back",
    );
  });

  it("redacts a key/value secret even right after a Basic or Bearer word", () => {
    const basic = connectErrorOf(new Error("rejected: Basic password: hunter2 for farm"));
    expect(basic.message).not.toContain("hunter2");
    const bearer = connectErrorOf(new Error("rejected: Bearer token: abc123xyz for farm"));
    expect(bearer.message).not.toContain("abc123xyz");
  });

  it("leaves ordinary words after Bearer or Basic alone", () => {
    expect(connectErrorOf(new Error("Basic auth is off")).message).toBe(
      "acquire failed: Basic auth is off",
    );
  });

  it("bounds a long body", () => {
    const wrapped = connectErrorOf(new Error(`bad gateway ${"x".repeat(5000)}`));
    expect(wrapped.message.length).toBe("acquire failed: ".length + 300);
  });

  it("does not keep the thrown value as the cause, so no raw text travels with the error", () => {
    const wrapped = connectErrorOf(new Error("secret https://u:p@farm.example.com/k"));
    expect(wrapped.cause).toBeUndefined();
    expect(wrapped.message).not.toContain("u:p");
    expect(wrapped.message).not.toContain("/k");
  });
});
