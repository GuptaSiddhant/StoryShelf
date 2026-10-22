import type { ShelfOptions } from "@storyshelf/core/config";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { setupPublishing } from "./publish-setup.ts";

const logger = pino({ level: "silent" });

function options(): ShelfOptions {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  return { database: db, storage } as unknown as ShelfOptions;
}

describe("setupPublishing", () => {
  it("wires a completer and a publish consumer on a long-running host", () => {
    const wiring = setupPublishing(options(), {}, logger, false, {});
    expect(wiring.enqueuePublish).toBeTypeOf("function");
    expect(wiring.consumer?.isRunning()).toBe(false);
    expect(wiring.afterPublish).toEqual([]);
  });

  it("wires no consumer and no job queue on a serverless host", () => {
    const wiring = setupPublishing(options(), {}, logger, false, { VERCEL: "1" });
    expect(wiring.enqueuePublish).toBeUndefined();
    expect(wiring.consumer).toBeNull();
  });

  it("starts and drains its consumer, and a never-started one stops quietly", async () => {
    const wiring = setupPublishing(options(), {}, logger, false, {});
    await wiring.consumer?.stop();
    const started = wiring.consumer?.start();
    await Promise.resolve();
    await wiring.consumer?.stop();
    await started;
    expect(wiring.consumer?.isRunning()).toBe(false);
  });
});
