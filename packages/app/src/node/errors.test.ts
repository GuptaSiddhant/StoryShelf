import { describe, expect, it } from "vitest";
import { sanitizedStartError, StartInterruptedError } from "./errors.ts";

describe("sanitizedStartError", () => {
  it("keeps a clean error itself, so its class, code and stack survive", () => {
    const error = Object.assign(new Error("listen EADDRINUSE: address already in use"), {
      code: "EADDRINUSE",
    });
    expect(sanitizedStartError(error)).toBe(error);
  });

  it("copies an error whose message holds a secret, redacted, keeping its name and code", () => {
    const error = Object.assign(new TypeError("cannot reach postgres://app:s3cret@db/shelf"), {
      code: "ECONNREFUSED",
      cause: new Error("password=s3cret"),
    });
    const safe = sanitizedStartError(error);
    expect(safe).not.toBe(error);
    expect(safe.message).toBe("cannot reach postgres://[redacted]@db/shelf");
    expect(safe.name).toBe("TypeError");
    expect(safe).toMatchObject({ code: "ECONNREFUSED" });
    expect(safe.cause).toBeUndefined();
  });

  it("wraps a thrown non-error as an error with a redacted message", () => {
    expect(sanitizedStartError("token=abc123").message).toBe("token=[redacted]");
  });
});

describe("StartInterruptedError", () => {
  it("names what interrupted the start-up", () => {
    const error = new StartInterruptedError("SIGTERM");
    expect(error.name).toBe("StartInterruptedError");
    expect(error.trigger).toBe("SIGTERM");
    expect(error.message).toContain("SIGTERM");
  });
});
