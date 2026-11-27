import type { ResolvedShelfOptions } from "@storyshelf/core/config";
import { createShelfLogger } from "@storyshelf/core/logger";
import { describe, expect, it, vi } from "vitest";
import { defaultTargetProblem, warnDefaultTargetAfterSetup } from "./browser-warning.ts";
import type { LifecycleCell } from "./lifecycle.ts";

type Targets = NonNullable<ResolvedShelfOptions["testing"]>["runner"]["metadata"]["targets"];

function options(targets: Targets): Pick<ResolvedShelfOptions, "testing"> {
  return {
    testing: { runner: { metadata: { targets } } },
  } as unknown as Pick<ResolvedShelfOptions, "testing">;
}

const MISSING = options([
  { target: "chromium", reach: "loopback", status: { unavailable: "declared, not installed" } },
  { target: "firefox", reach: "loopback", status: "ready" },
]);

function cellOf(ok: boolean): LifecycleCell {
  return { ready: Promise.resolve({ ok, failures: [] }), settled: null, consumer: null };
}

describe("defaultTargetProblem", () => {
  it("names the default target when it is declared but not installed", () => {
    expect(defaultTargetProblem(MISSING)).toBe("chromium: declared, not installed");
  });

  it("is null for a ready default, a later unavailable target, a remote one or no runner", () => {
    expect(
      defaultTargetProblem(options([{ target: "chromium", reach: "loopback", status: "ready" }])),
    ).toBeNull();
    expect(
      defaultTargetProblem(
        options([
          { target: "chromium", reach: "loopback", status: "ready" },
          { target: "firefox", reach: "loopback", status: { unavailable: "x" } },
        ]),
      ),
    ).toBeNull();
    expect(
      defaultTargetProblem(
        options([{ target: "chromium@grid", reach: "url", status: { unavailable: "x" } }]),
      ),
    ).toBeNull();
    expect(defaultTargetProblem({})).toBeNull();
    expect(defaultTargetProblem(options([]))).toBeNull();
  });
});

describe("warnDefaultTargetAfterSetup", () => {
  it("logs one warning once setup is ok", async () => {
    const logger = createShelfLogger({ level: "silent" });
    const warn = vi.spyOn(logger, "warn");
    const cell = cellOf(true);
    warnDefaultTargetAfterSetup(cell, MISSING, logger);
    await cell.ready;
    await new Promise((resolve) => setImmediate(resolve));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[1])).toContain("chromium: declared, not installed");
  });

  it("logs nothing when setup failed", async () => {
    const logger = createShelfLogger({ level: "silent" });
    const warn = vi.spyOn(logger, "warn");
    const cell = cellOf(false);
    warnDefaultTargetAfterSetup(cell, MISSING, logger);
    await new Promise((resolve) => setImmediate(resolve));
    expect(warn).not.toHaveBeenCalled();
  });
});
