import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CaptureRunner } from "./adapters/capture-runner.ts";
import type { ShelfOptions } from "./config.ts";
import { DEFAULT_SCRATCH_DIR, resolveShelfOptions } from "./options.ts";

const runner = { metadata: { kind: "r" } } as unknown as CaptureRunner;
const base = {
  database: { metadata: { name: "Fake", kind: "fake", category: "database" } },
  storage: {},
} as unknown as ShelfOptions;

describe("resolveShelfOptions", () => {
  it("defaults scratchDir for a hosting-only deployment: publishing extracts zips there", () => {
    expect(resolveShelfOptions(base).config?.scratchDir).toBe(DEFAULT_SCRATCH_DIR);
  });

  it("defaults scratchDir when a runner needs it", () => {
    expect(DEFAULT_SCRATCH_DIR).toBe(join(tmpdir(), "storyshelf"));
    const resolved = resolveShelfOptions({ ...base, testing: { runner } });
    expect(resolved.config?.scratchDir).toBe(DEFAULT_SCRATCH_DIR);
  });

  it("defaults scratchDir for a queue-only deployment too", () => {
    const queue = { metadata: { kind: "q" } } as never;
    expect(resolveShelfOptions({ ...base, testing: { queue } }).config?.scratchDir).toBe(
      DEFAULT_SCRATCH_DIR,
    );
  });

  it("keeps the other config keys when defaulting scratchDir", () => {
    const resolved = resolveShelfOptions({ ...base, config: { maxInlineUnzipSize: 10 } });
    expect(resolved.config).toEqual({ maxInlineUnzipSize: 10, scratchDir: DEFAULT_SCRATCH_DIR });
  });

  it("keeps an explicit scratchDir and the rest of the config", () => {
    const resolved = resolveShelfOptions({
      ...base,
      testing: { runner },
      config: { scratchDir: "/data", purgeTtlDays: 7 },
    });
    expect(resolved.config).toEqual({ scratchDir: "/data", purgeTtlDays: 7 });
  });

  it("validates testing.compare.threads", () => {
    expect(() =>
      resolveShelfOptions({ ...base, testing: { runner, compare: { threads: -1 } } }),
    ).toThrow(/testing\.compare\.threads/u);
    expect(() =>
      resolveShelfOptions({ ...base, testing: { runner, compare: { threads: 1.5 } } }),
    ).toThrow(/testing\.compare\.threads/u);
    expect(
      resolveShelfOptions({ ...base, testing: { runner, compare: { threads: 0 } } }).testing
        ?.compare?.threads,
    ).toBe(0);
  });

  it("requires a runner or a queue whenever testing is set", () => {
    expect(() => resolveShelfOptions({ ...base, testing: {} })).toThrow(
      /testing requires testing\.runner/u,
    );
    expect(() => resolveShelfOptions({ ...base, testing: { concurrency: 2 } })).toThrow(
      /testing requires testing\.runner/u,
    );
  });

  it("refuses testing on a database that cannot back it, but hosts on it", () => {
    const d1 = {
      ...base,
      database: { metadata: { name: "Cloudflare D1", supportsTesting: false } },
    } as unknown as ShelfOptions;
    expect(() => resolveShelfOptions({ ...d1, testing: { runner } })).toThrow(
      /Cloudflare D1 database cannot back testing/u,
    );
    expect(resolveShelfOptions(d1).testing).toBeUndefined();
    // A remote-queue-only instance renders nowhere here, so it is not refused.
    const queue = { metadata: { kind: "q" } } as never;
    expect(resolveShelfOptions({ ...d1, testing: { queue } }).testing?.queue).toBe(queue);
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
    resolveShelfOptions({ ...base, testing: { runner, shardSize, ...extra } });
  };
}

function concurrent(concurrency: number): () => void {
  return () => {
    resolveShelfOptions({ ...base, testing: { runner, concurrency } });
  };
}

describe("resolveShelfOptions testing process options", () => {
  it("requires a runner alongside workerEntry", () => {
    expect(() =>
      resolveShelfOptions({ ...base, testing: { workerEntry: "/app/capture-worker.ts" } }),
    ).toThrow(/requires testing\.runner/u);
  });

  it("validates shardSize", () => {
    expect(shardSized(100)).not.toThrow();
    expect(shardSized(0)).toThrow(/positive integer/u);
    expect(shardSized(1.5)).toThrow(/positive integer/u);
    expect(shardSized(10, { workerEntry: "/app/w.ts" })).not.toThrow();
    expect(() => resolveShelfOptions({ ...base, testing: { shardSize: 10 } })).toThrow(
      /requires testing\.runner/u,
    );
  });

  it("validates concurrency as a positive integer", () => {
    expect(concurrent(2)).not.toThrow();
    expect(concurrent(0)).toThrow(/testing\.concurrency must be a positive integer, got 0/u);
    expect(concurrent(2.5)).toThrow(/positive integer/u);
    expect(concurrent(-1)).toThrow(/positive integer/u);
  });

  it('requires workerEntry for mode "fork"', () => {
    expect(() => resolveShelfOptions({ ...base, testing: { runner, mode: "fork" } })).toThrow(
      /requires testing\.workerEntry/u,
    );
  });

  it("accepts a runner with a worker entry and any mode", () => {
    for (const mode of ["auto", "in-process", "fork"] as const) {
      expect(() =>
        resolveShelfOptions({ ...base, testing: { runner, workerEntry: "/app/w.ts", mode } }),
      ).not.toThrow();
    }
  });
});
