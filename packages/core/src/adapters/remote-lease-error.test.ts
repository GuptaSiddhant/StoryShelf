import { describe, expect, it } from "vite-plus/test";
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
});
