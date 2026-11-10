import { describe, expect, it, vi } from "vite-plus/test";
import { activeRuns, cancelRuns, finishing, messageOf, outcomeOf, trackRun } from "./browser.ts";

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

describe("messageOf", () => {
  it("gives an Error's message exactly", () => {
    expect(messageOf(new Error("boom", { cause: new Error("inner") }))).toBe("boom");
  });

  it("says what a non-Error value says instead of [object Object]", () => {
    expect(messageOf({ type: "error", error: new Error("ECONNREFUSED") })).toBe("ECONNREFUSED");
    expect(messageOf("plain")).toBe("plain");
    expect(messageOf(null)).toBe("unknown error");
    expect(messageOf({})).toBe("unknown error");
  });

  it("redacts secrets in a value that is not an Error", () => {
    expect(messageOf({ message: "refused, api_key=supersecret" })).not.toContain("supersecret");
  });
});

describe("trackRun and cancelRuns", () => {
  it("registers the run while it works, and removes it however it ends", async () => {
    await trackRun({ buildId: "track-1", runId: "a" }, async () => {
      expect(activeRuns.matching("track-1", "a")).toHaveLength(1);
      return await Promise.resolve();
    });
    expect(activeRuns.matching("track-1")).toHaveLength(0);
    await expect(
      trackRun({ buildId: "track-1", runId: "a" }, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(activeRuns.matching("track-1")).toHaveLength(0);
  });

  it("cancels exactly the runs it names, aborting and releasing their sessions", async () => {
    const release = vi.fn(async () => await Promise.resolve());
    let named: { cancelled: boolean; abort?: AbortController | undefined } | undefined;
    let other: { cancelled: boolean } | undefined;
    const started = Promise.withResolvers<boolean>();
    const finish = Promise.withResolvers<boolean>();
    const first = trackRun({ buildId: "track-2", runId: "a" }, async (active) => {
      active.session = { release } as never;
      named = active;
      started.resolve(true);
      await finish.promise;
    });
    const second = trackRun({ buildId: "track-2", runId: "b" }, async (active) => {
      other = active;
      await finish.promise;
    });
    await started.promise;
    await cancelRuns("track-2", "a");
    expect(named?.cancelled).toBe(true);
    expect(named?.abort?.signal.aborted).toBe(true);
    expect(release).toHaveBeenCalledWith("cancelled");
    expect(other?.cancelled).toBe(false);
    finish.resolve(true);
    await Promise.all([first, second]);
  });
});
