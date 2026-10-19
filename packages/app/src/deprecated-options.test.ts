// oxlint-disable typescript/no-deprecated -- exercises the deprecated flat aliases on purpose
import type { CaptureRunner } from "@storyshelf/core/adapter/capture-runner";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { createShelfApp } from "./index.tsx";

function runner(): CaptureRunner {
  return {
    metadata: { name: "mock", version: "0.0.0", kind: "mock", category: "capture-runner" },
    render: async () => ({ captures: [], failures: [] }),
    cancel: async () => {},
  } as unknown as CaptureRunner;
}

/** A silent logger whose warn-level calls are recorded. */
function recordingLogger() {
  const logger = pino({ level: "silent" });
  const warn = vi.spyOn(logger, "warn");
  const warnings = (): Record<string, unknown>[] =>
    warn.mock.calls.map((call) => call[0] as unknown as Record<string, unknown>);
  return { logger, warnings };
}

describe("createShelfApp capture options", () => {
  it("warns once at boot about deprecated flat capture options", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const { logger, warnings } = recordingLogger();
    createShelfApp({
      database: db,
      storage,
      logger,
      captureRunner: runner(),
      config: { captureConcurrency: 2 },
    });
    const deprecated = warnings().filter((entry) => Array.isArray(entry["deprecated"]));
    expect(deprecated).toHaveLength(1);
    expect(deprecated[0]?.["deprecated"]).toEqual([
      "captureRunner → capture.runner",
      "config.captureConcurrency → capture.concurrency",
    ]);
  });

  it("stays quiet with the nested options", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const { logger, warnings } = recordingLogger();
    createShelfApp({
      database: db,
      storage,
      logger,
      capture: { runner: runner(), concurrency: 2 },
      compare: { threads: 0 },
    });
    expect(warnings().filter((entry) => Array.isArray(entry["deprecated"]))).toEqual([]);
  });

  it("runs hosting-only with no capture options at all", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const { logger } = recordingLogger();
    expect(() => createShelfApp({ database: db, storage, logger })).not.toThrow();
  });

  it("rejects an invalid compare.threads", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    expect(() => createShelfApp({ database: db, storage, compare: { threads: -2 } })).toThrow(
      /compare\.threads/u,
    );
  });
});
