import { describe, expect, it } from "vitest";
import { loginFailureOf } from "./auth-login-failure.ts";

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
});
