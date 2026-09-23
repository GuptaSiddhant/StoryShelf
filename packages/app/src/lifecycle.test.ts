import type { ShelfOptions } from "@storyshelf/core/config";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import type { ShelfRouter } from "./app-types.ts";
import { attachLifecycle, type LifecycleCell } from "./lifecycle.ts";
import type { ServerRuntime } from "./runtime.ts";

const silentLogger = pino({ level: "silent" });

function fakeAdapter(kind: string, setLogger?: (logger: unknown) => void) {
  return {
    metadata: { name: kind, version: "0.0.0", kind, category: "capture-queue" },
    ...(setLogger ? { setLogger } : {}),
  };
}

describe("attachLifecycle", () => {
  it("binds scoped host loggers on adapters that accept them", async () => {
    const setLoggerDb = vi.fn();
    const setLoggerQueue = vi.fn();
    const options = {
      database: fakeAdapter("postgres", setLoggerDb),
      storage: fakeAdapter("local"),
      captureQueue: fakeAdapter("sqs", setLoggerQueue),
    } as unknown as ShelfOptions;
    const runtime = {
      config: { branchTtlDays: null },
      logger: silentLogger,
    } as unknown as ServerRuntime;
    const cell: LifecycleCell = {
      ready: Promise.resolve({ ok: true, failures: [] }),
      settled: null,
    };
    attachLifecycle({} as ShelfRouter, options, runtime, cell);
    expect(setLoggerDb).toHaveBeenCalledOnce();
    expect(setLoggerQueue).toHaveBeenCalledOnce();
    const bound = setLoggerQueue.mock.calls[0]?.[0] as {
      bindings?: () => Record<string, unknown>;
    };
    expect(bound.bindings?.()).toMatchObject({ component: "sqs" });
    await cell.ready;
  });
});
