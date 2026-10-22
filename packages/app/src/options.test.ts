import type { CaptureRunner } from "@storyshelf/core/adapter/capture-runner";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "./index.tsx";

const logger = pino({ level: "silent" });

function runner(): CaptureRunner {
  return {
    metadata: { name: "mock", version: "0.0.0", kind: "mock", category: "capture-runner" },
    render: async () => ({ captures: [], failures: [] }),
    cancel: async () => {},
  } as unknown as CaptureRunner;
}

describe("createShelfApp testing, compare and notifications options", () => {
  it("boots hosting-only with no testing options at all", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    expect(() => createShelfApp({ database: db, storage, logger })).not.toThrow();
  });

  it("boots with the nested testing, compare and notifications options", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    expect(() =>
      createShelfApp({
        database: db,
        storage,
        logger,
        testing: { runner: runner(), concurrency: 2, compare: { threads: 0 } },
        notifications: { notifiers: [], config: { fromEmail: "shelf@example.com" } },
      }),
    ).not.toThrow();
  });

  it("rejects an invalid testing.compare.threads", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    expect(() =>
      createShelfApp({ database: db, storage, testing: { compare: { threads: -2 } } }),
    ).toThrow(/testing\.compare\.threads/u);
  });

  it("rejects an invalid notifications.config", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    expect(() =>
      createShelfApp({ database: db, storage, notifications: { config: { fromEmail: "" } } }),
    ).toThrow(/notifications\.config/u);
  });

  it("no longer accepts the removed config keys", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    for (const config of [{ captureConcurrency: 2 }, { notifications: { fromEmail: "a@b.c" } }]) {
      expect(() => createShelfApp({ database: db, storage, config: config as never })).toThrow(
        /Invalid ShelfConfig/u,
      );
    }
  });
});
