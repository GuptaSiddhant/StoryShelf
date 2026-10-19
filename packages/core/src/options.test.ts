import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CaptureRunner } from "./adapters/capture-runner.ts";
import type { ShelfOptions } from "./config.ts";
import { DEFAULT_SCRATCH_DIR, resolveShelfOptions } from "./options.ts";

const runner = { metadata: { kind: "r" } } as unknown as CaptureRunner;
const base = { database: {}, storage: {} } as unknown as ShelfOptions;

describe("resolveShelfOptions", () => {
  it("leaves a hosting-only deployment untouched", () => {
    expect(resolveShelfOptions(base)).toBe(base);
  });

  it("defaults scratchDir when a runner needs it", () => {
    expect(DEFAULT_SCRATCH_DIR).toBe(join(tmpdir(), "storyshelf"));
    const resolved = resolveShelfOptions({ ...base, capture: { runner } });
    expect(resolved.config?.scratchDir).toBe(DEFAULT_SCRATCH_DIR);
  });

  it("does not default scratchDir for a queue-only deployment", () => {
    const queue = { metadata: { kind: "q" } } as never;
    expect(resolveShelfOptions({ ...base, capture: { queue } }).config).toBeUndefined();
  });

  it("defaults scratchDir for inline statics extraction too", () => {
    const resolved = resolveShelfOptions({ ...base, config: { maxInlineUnzipSize: 10 } });
    expect(resolved.config?.scratchDir).toBe(DEFAULT_SCRATCH_DIR);
  });

  it("keeps an explicit scratchDir and the rest of the config", () => {
    const resolved = resolveShelfOptions({
      ...base,
      capture: { runner },
      config: { scratchDir: "/data", purgeTtlDays: 7 },
    });
    expect(resolved.config).toEqual({ scratchDir: "/data", purgeTtlDays: 7 });
  });

  it("validates compare.threads", () => {
    expect(() => resolveShelfOptions({ ...base, compare: { threads: -1 } })).toThrow(
      /compare\.threads/u,
    );
    expect(() => resolveShelfOptions({ ...base, compare: { threads: 1.5 } })).toThrow(
      /compare\.threads/u,
    );
    expect(resolveShelfOptions({ ...base, compare: { threads: 0 } }).compare?.threads).toBe(0);
  });

  it("validates notifications.config", () => {
    expect(() =>
      resolveShelfOptions({ ...base, notifications: { config: { fromEmail: "" } } }),
    ).toThrow(/notifications\.config/u);
    expect(() =>
      resolveShelfOptions({ ...base, notifications: { config: { fromEmail: "a@b.c" } } }),
    ).not.toThrow();
  });
});

function shardSized(shardSize: number, extra = {}): () => void {
  return () => {
    resolveShelfOptions({ ...base, capture: { runner, shardSize, ...extra } });
  };
}

describe("resolveShelfOptions capture process options", () => {
  it("requires a runner alongside workerEntry", () => {
    expect(() =>
      resolveShelfOptions({ ...base, capture: { workerEntry: "/app/capture-worker.ts" } }),
    ).toThrow(/requires capture\.runner/u);
  });

  it("validates shardSize", () => {
    expect(shardSized(100)).not.toThrow();
    expect(shardSized(0)).toThrow(/positive integer/u);
    expect(shardSized(1.5)).toThrow(/positive integer/u);
    expect(shardSized(10, { workerEntry: "/app/w.ts" })).not.toThrow();
    expect(() => resolveShelfOptions({ ...base, capture: { shardSize: 10 } })).toThrow(
      /requires capture\.runner/u,
    );
  });

  it('requires workerEntry for mode "fork"', () => {
    expect(() => resolveShelfOptions({ ...base, capture: { runner, mode: "fork" } })).toThrow(
      /requires capture\.workerEntry/u,
    );
  });

  it("accepts a runner with a worker entry and any mode", () => {
    for (const mode of ["auto", "in-process", "fork"] as const) {
      expect(() =>
        resolveShelfOptions({ ...base, capture: { runner, workerEntry: "/app/w.ts", mode } }),
      ).not.toThrow();
    }
  });
});
