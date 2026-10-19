// oxlint-disable typescript/no-deprecated -- these tests exercise the deprecated flat aliases
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CaptureQueue } from "./adapters/capture-queue.ts";
import type { CaptureRunner } from "./adapters/capture-runner.ts";
import { DEFAULT_SCRATCH_DIR, normalizeShelfOptions } from "./config-compat.ts";
import type { ShelfOptions } from "./config.ts";

const runner = { metadata: { kind: "r" } } as unknown as CaptureRunner;
const otherRunner = { metadata: { kind: "other" } } as unknown as CaptureRunner;
const queue = { metadata: { kind: "q" } } as unknown as CaptureQueue;
const base = { database: {}, storage: {} } as unknown as ShelfOptions;

describe("normalizeShelfOptions", () => {
  it("leaves a hosting-only deployment untouched", () => {
    const { options, deprecated } = normalizeShelfOptions(base);
    expect(deprecated).toEqual([]);
    expect(options.capture).toEqual({
      runner: undefined,
      queue: undefined,
      concurrency: undefined,
    });
    expect(options.config).toBeUndefined();
  });

  it("accepts the nested capture options and mirrors them for internals", () => {
    const { options, deprecated } = normalizeShelfOptions({
      ...base,
      capture: { runner, queue, concurrency: 3 },
    });
    expect(deprecated).toEqual([]);
    expect(options.captureRunner).toBe(runner);
    expect(options.captureQueue).toBe(queue);
    expect(options.config?.captureConcurrency).toBe(3);
  });

  it("still accepts the flat aliases and reports each once", () => {
    const { options, deprecated } = normalizeShelfOptions({
      ...base,
      captureRunner: runner,
      captureQueue: queue,
      config: { captureConcurrency: 2 },
    });
    expect(options.capture).toEqual({ runner, queue, concurrency: 2 });
    expect(deprecated).toEqual([
      "captureRunner → capture.runner",
      "captureQueue → capture.queue",
      "config.captureConcurrency → capture.concurrency",
    ]);
  });

  it("prefers the nested option and says the flat one was ignored", () => {
    const { options, deprecated } = normalizeShelfOptions({
      ...base,
      capture: { runner, concurrency: 4 },
      captureRunner: otherRunner,
      config: { captureConcurrency: 1 },
    });
    expect(options.capture?.runner).toBe(runner);
    expect(options.config?.captureConcurrency).toBe(4);
    expect(deprecated).toEqual([
      "captureRunner → capture.runner (ignored: both set)",
      "config.captureConcurrency → capture.concurrency (ignored: both set)",
    ]);
  });

  it("defaults scratchDir when a runner needs it, but not for hosting only", () => {
    expect(DEFAULT_SCRATCH_DIR).toBe(join(tmpdir(), "storyshelf"));
    expect(normalizeShelfOptions({ ...base, capture: { runner } }).options.config?.scratchDir).toBe(
      DEFAULT_SCRATCH_DIR,
    );
    expect(normalizeShelfOptions({ ...base, capture: { queue } }).options.config).toBeUndefined();
  });

  it("defaults scratchDir for inline statics extraction too", () => {
    const { options } = normalizeShelfOptions({ ...base, config: { maxInlineUnzipSize: 10 } });
    expect(options.config?.scratchDir).toBe(DEFAULT_SCRATCH_DIR);
  });

  it("keeps an explicit scratchDir", () => {
    const { options } = normalizeShelfOptions({
      ...base,
      capture: { runner },
      config: { scratchDir: "/data" },
    });
    expect(options.config?.scratchDir).toBe("/data");
  });

  it("validates compare.threads", () => {
    expect(() => normalizeShelfOptions({ ...base, compare: { threads: -1 } })).toThrow(
      /compare\.threads/u,
    );
    expect(() => normalizeShelfOptions({ ...base, compare: { threads: 1.5 } })).toThrow(
      /compare\.threads/u,
    );
    expect(
      normalizeShelfOptions({ ...base, compare: { threads: 0 } }).options.compare?.threads,
    ).toBe(0);
  });
});
