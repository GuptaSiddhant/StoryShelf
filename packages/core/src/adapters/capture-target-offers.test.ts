import { describe, expect, it, vi } from "vitest";
import { createTargetOffers } from "./capture-target-offers.ts";
import { TargetLaunchError, type RunnerTarget } from "./capture-target.ts";

const declared: RunnerTarget[] = [
  { target: "chromium", reach: "loopback", status: "ready" },
  { target: "firefox", reach: "loopback", status: "ready" },
];

describe("createTargetOffers", () => {
  it("offers the declared targets, the first being the default", () => {
    const offers = createTargetOffers(declared);
    expect(offers.defaultTarget).toBe("chromium");
    expect(offers.current()).toEqual(declared);
    expect(() => createTargetOffers([])).toThrow(/at least one target/u);
  });

  it("launches an offered target and refuses one it does not offer", async () => {
    const launch = vi.fn(async (target: string) => await Promise.resolve(`browser:${target}`));
    const guarded = createTargetOffers(declared).guard(launch);
    expect(await guarded("firefox")).toBe("browser:firefox");
    await expect(guarded("webkit")).rejects.toThrow(
      "Cannot launch webkit: not offered by this runner",
    );
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("marks a target unavailable when its launch fails, and leaves other errors alone", async () => {
    const offers = createTargetOffers(declared);
    const guarded = offers.guard(async (target) => {
      await Promise.resolve();
      if (target === "firefox") {
        throw new TargetLaunchError("firefox", "missing libs");
      }
      throw new Error("not a launch failure");
    });
    await expect(guarded("firefox")).rejects.toBeInstanceOf(TargetLaunchError);
    await expect(guarded("chromium")).rejects.toThrow("not a launch failure");
    expect(offers.current().map((entry) => entry.status)).toEqual([
      "ready",
      { unavailable: "missing libs" },
    ]);
  });

  it("replaces the statuses with what setup verifies and reports them in health", async () => {
    const offers = createTargetOffers(declared);
    const lifecycle = offers.lifecycle(
      async () =>
        await Promise.resolve([
          declared[0] as RunnerTarget,
          { ...(declared[1] as RunnerTarget), status: { unavailable: "declared, not installed" } },
        ]),
    );
    expect(await lifecycle.health()).toEqual({ ok: true });
    await lifecycle.setup({} as never);
    expect(await lifecycle.health()).toEqual({
      ok: true,
      detail: "firefox: declared, not installed",
    });
    await expect(lifecycle.teardown()).resolves.toBeUndefined();
  });

  it("reports unhealthy when no target can render", async () => {
    const offers = createTargetOffers([declared[0] as RunnerTarget]);
    const lifecycle = offers.lifecycle(
      async () =>
        await Promise.resolve([{ ...(declared[0] as RunnerTarget), status: { unavailable: "x" } }]),
    );
    await lifecycle.setup({} as never);
    expect((await lifecycle.health()).ok).toBe(false);
  });
});
