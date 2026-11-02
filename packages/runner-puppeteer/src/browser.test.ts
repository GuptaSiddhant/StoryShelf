import { describe, expect, it, vi } from "vitest";
import { finishing, outcomeOf } from "./browser.ts";

describe("outcomeOf", () => {
  it("lets a cancel win over a failure, and a failure over a finish", () => {
    expect(outcomeOf({ cancelled: true }, true)).toBe("cancelled");
    expect(outcomeOf({ cancelled: false }, true)).toBe("failed");
    expect(outcomeOf({ cancelled: false }, false)).toBe("finished");
  });
});

describe("finishing", () => {
  it("passes a thrown error to finish, as failed, and rethrows it", async () => {
    const finish = vi.fn(async () => await Promise.resolve());
    const boom = new Error("boom");
    await expect(finishing(() => Promise.reject(boom), finish)).rejects.toBe(boom);
    expect(finish).toHaveBeenCalledWith(true, boom);
  });

  it("finishes as finished when the work resolves", async () => {
    const finish = vi.fn(async () => await Promise.resolve());
    await expect(finishing(async () => await Promise.resolve(7), finish)).resolves.toBe(7);
    expect(finish).toHaveBeenCalledWith(false, undefined);
  });
});
