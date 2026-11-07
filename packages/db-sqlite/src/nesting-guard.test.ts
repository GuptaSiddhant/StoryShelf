import { describe, expect, it, vi } from "vitest";
import { createNestingGuard } from "./nesting-guard.ts";

describe("createNestingGuard", () => {
  it("is outside a transaction by default, inside one while its body runs, and outside after", async () => {
    const guard = createNestingGuard();
    expect(guard.inside()).toBe(false);

    const during = await guard.enter(async () => await Promise.resolve(guard.inside()));

    expect(during).toBe(true);
    expect(guard.inside()).toBe(false);
  });

  it("stays inside for work the body starts while it runs, and outside for that work once it ended", async () => {
    const guard = createNestingGuard();
    const gate = Promise.withResolvers<null>();
    let retained: Promise<boolean> = Promise.resolve(true);

    await guard.enter(async () => {
      // Started inside the body, so it keeps the body's async context after the body is over.
      retained = (async () => {
        await gate.promise;
        return guard.inside();
      })();
      return await Promise.resolve(guard.inside());
    });
    gate.resolve(null);

    await expect(retained).resolves.toBe(false);
  });

  it("keeps the state of two guards apart", async () => {
    const first = createNestingGuard();
    const second = createNestingGuard();

    const [firstSees, secondSees] = await first.enter(
      async () => [first.inside(), second.inside()] as const,
    );

    expect(firstSees).toBe(true);
    expect(secondSees).toBe(false);
  });

  it("ends the scope when the body throws", async () => {
    const guard = createNestingGuard();

    await expect(guard.enter(async () => await Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    expect(guard.inside()).toBe(false);
  });

  it("detects nothing where the runtime cannot look modules up, and still runs the body", async () => {
    const lookup = vi.spyOn(process, "getBuiltinModule").mockImplementation(() => {});
    try {
      const guard = createNestingGuard();

      const during = await guard.enter(async () => await Promise.resolve(guard.inside()));

      expect(during).toBe(false);
    } finally {
      lookup.mockRestore();
    }
  });
});
