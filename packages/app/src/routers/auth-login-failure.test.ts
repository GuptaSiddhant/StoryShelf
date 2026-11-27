import { describe, expect, it } from "vitest";
import { ENGINE_INVALID_ORIGIN, engineErrorCode, loginFailureOf } from "./auth-login-failure.ts";

describe("loginFailureOf", () => {
  it("propagates a rate limit without raising the signal", () => {
    expect(loginFailureOf(429)).toEqual({
      message: "Invalid credentials",
      status: 429,
      notify: false,
    });
  });

  it("answers any upstream error as 502 without raising the signal", () => {
    for (const status of [500, 502, 503]) {
      expect(loginFailureOf(status)).toEqual({
        message: "Invalid credentials",
        status: 502,
        notify: false,
      });
    }
  });

  it("asks for a valid email on a 400, without raising the signal", () => {
    expect(loginFailureOf(400)).toEqual({
      message: "Enter a valid email address",
      status: 400,
      notify: false,
    });
  });

  it("answers a credential failure as 401 and raises the signal", () => {
    for (const status of [401, 403, 404]) {
      expect(loginFailureOf(status)).toEqual({
        message: "Invalid credentials",
        status: 401,
        notify: true,
      });
    }
  });

  it("answers the engine's origin refusal as the wrong address, without raising the signal", () => {
    expect(loginFailureOf(403, ENGINE_INVALID_ORIGIN)).toMatchObject({
      status: 403,
      notify: false,
      wrongAddress: true,
    });
  });

  it("keeps every other refusal generic, a 403 without the origin code included", () => {
    for (const [status, code] of [
      [403, undefined],
      [403, "INVALID_EMAIL_OR_PASSWORD"],
      [401, ENGINE_INVALID_ORIGIN],
    ] as const) {
      expect(loginFailureOf(status, code)).toEqual({
        message: "Invalid credentials",
        status: 401,
        notify: true,
      });
    }
  });
});

describe("engineErrorCode", () => {
  it("reads the code of an engine error answer", async () => {
    const response = Response.json({ code: "INVALID_ORIGIN", message: "Invalid origin" });
    expect(await engineErrorCode(response)).toBe("INVALID_ORIGIN");
  });

  it("is undefined for an answer without a string code or that is not JSON", async () => {
    expect(await engineErrorCode(Response.json({ message: "nope" }))).toBeUndefined();
    expect(await engineErrorCode(Response.json({ code: 403 }))).toBeUndefined();
    expect(await engineErrorCode(Response.json(null))).toBeUndefined();
    expect(await engineErrorCode(new Response("<html>"))).toBeUndefined();
  });
});
