import { describe, expect, it } from "vitest";
import type { JobRunContext } from "../consumer/types.ts";
import { jobKey, RunBook } from "./runs.ts";

const context: JobRunContext = { logger: {} as never, touch: () => {} };

describe("RunBook", () => {
  it("lets ordinary runs start side by side", () => {
    const book = new RunBook();
    expect(book.canStart(false)).toBe(true);
    book.add({ buildId: "a" }, context, false);
    expect(book.canStart(false)).toBe(true);
    expect(book.size).toBe(1);
  });

  it("makes a solo run wait for an empty child, and holds everyone else while it runs", () => {
    const book = new RunBook();
    const first = book.add({ buildId: "a" }, context, false);
    expect(book.canStart(true)).toBe(false);
    book.finish(first.runId, { kind: "done" });
    expect(book.canStart(true)).toBe(true);
    book.add({ buildId: "b" }, context, true);
    expect(book.canStart(false)).toBe(false);
    expect(book.canStart(true)).toBe(false);
  });

  it("settles a run with its verdict and wakes the waiters", async () => {
    const book = new RunBook();
    const run = book.add({ buildId: "a" }, context, false);
    let woken = false;
    const waiting = book.changed().then(() => {
      woken = true;
    });
    book.finish(run.runId, { kind: "failed", error: "boom" });
    await waiting;
    expect(woken).toBe(true);
    expect(await run.verdict).toEqual({ kind: "failed", error: "boom" });
    expect(book.get(run.runId)).toBeUndefined();
    // Finishing a run twice, or one that never existed, is harmless.
    expect(() => {
      book.finish(run.runId, { kind: "done" });
      book.finish("run-99", { kind: "done" });
    }).not.toThrow();
  });

  it("finds a run by its job, and hands every run back when the child is gone", () => {
    const book = new RunBook();
    const run = book.add({ buildId: "a", receipt: "j1:1" }, context, false);
    book.add({ buildId: "b", shard: "b:render:1" }, context, false);
    expect(book.runOf({ buildId: "a", receipt: "j1:1" })).toBe(run);
    expect(book.runOf({ buildId: "b", shard: "b:render:1" })?.job.buildId).toBe("b");
    expect(book.runOf({ buildId: "zzz" })).toBeUndefined();
    expect(book.takeAll()).toHaveLength(2);
    expect(book.size).toBe(0);
  });
});

describe("jobKey", () => {
  it("prefers the lease receipt, else the build and shard", () => {
    expect(jobKey({ buildId: "a", receipt: "j1:2" })).toBe("j1:2");
    expect(jobKey({ buildId: "a" })).toBe("a:");
    expect(jobKey({ buildId: "a", shard: "a:render:1" })).toBe("a:a:render:1");
  });
});
