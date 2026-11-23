import type { Logger } from "@storyshelf/core/logger";
import { describe, expect, it, vi } from "vitest";
import { engineRateLimit } from "./rate-limit.ts";

const CURRENT = { window: 10, max: 3 };

function rule(logger: Logger | null = null): (request: Request) => unknown {
  const customRules = engineRateLimit(true, logger).customRules;
  const fn = customRules["/**"];
  if (!fn) {
    throw new Error("no catch-all rule");
  }
  return (request) => fn(request, CURRENT);
}

function from(client?: string): Request {
  return new Request("http://localhost:3000/api/auth/sign-in/email", {
    headers: client === undefined ? {} : { "x-forwarded-for": client },
  });
}

describe("engineRateLimit", () => {
  it("passes the engine's own limit through for a request that names one client", () => {
    expect(rule()(from("203.0.113.7"))).toEqual(CURRENT);
    expect(rule()(from("2001:db8::1"))).toEqual(CURRENT);
  });

  it("skips the limit when no client is named, and warns once with the reason only", () => {
    const warn = vi.fn();
    const skip = rule({ warn } as unknown as Logger);
    expect(skip(from())).toBe(false);
    expect(skip(from("not-an-ip, 203.0.113.9"))).toBe(false);
    expect(skip(from())).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ reason: "no client address" }, expect.any(String));
  });

  it("carries only the switch it was given", () => {
    expect(engineRateLimit(null, null)).not.toHaveProperty("enabled");
    expect(engineRateLimit(false, null).enabled).toBe(false);
  });
});
