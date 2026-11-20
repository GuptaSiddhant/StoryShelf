import { describe, expect, it, vi } from "vitest";
import { exitBy, FLY_DEFAULT_GRACE_SECONDS, FORCED_EXIT_MS, shutdownGraceMs } from "./shutdown.ts";

describe("shutdownGraceMs", () => {
  it("reads SHUTDOWN_GRACE_SECONDS as milliseconds", () => {
    expect(shutdownGraceMs({ SHUTDOWN_GRACE_SECONDS: "25" })).toBe(25_000);
    expect(shutdownGraceMs({ SHUTDOWN_GRACE_SECONDS: "0", FLY_APP_NAME: "demo" })).toBe(0);
  });

  it("defaults below Fly's kill timeout on Fly, and leaves the drain unbounded elsewhere", () => {
    expect(shutdownGraceMs({ FLY_APP_NAME: "demo" })).toBe(FLY_DEFAULT_GRACE_SECONDS * 1000);
    expect(shutdownGraceMs({})).toBeUndefined();
    expect(shutdownGraceMs({ SHUTDOWN_GRACE_SECONDS: "" })).toBeUndefined();
  });

  it("refuses a value that is not a whole number of seconds", () => {
    for (const raw of ["2.5", "-1", "ten", "10s"]) {
      expect(() => shutdownGraceMs({ SHUTDOWN_GRACE_SECONDS: raw })).toThrow(
        "SHUTDOWN_GRACE_SECONDS must be a whole number of seconds",
      );
    }
  });
});

describe("exitBy", () => {
  it("exits a second past the grace, with an unref'd timer", () => {
    vi.useFakeTimers();
    try {
      const exit = vi.fn();
      exitBy(5000, exit);
      vi.advanceTimersByTime(5000 + FORCED_EXIT_MS - 1);
      expect(exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
