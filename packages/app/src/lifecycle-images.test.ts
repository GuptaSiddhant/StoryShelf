import type { ShelfOptions } from "@storyshelf/core/config";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { expect, it, vi } from "vitest";
import type { ShelfRouter } from "./app-types.ts";
import { attachLifecycle, type LifecycleCell } from "./lifecycle.ts";
import type { ServerRuntime } from "./runtime.ts";

// The lifecycle only needs these two image hooks; the engine that cannot load is simulated here.
vi.mock("@storyshelf/core/diff", () => ({
  shutdownDiffPool: async (): Promise<void> => {},
  verifyImageEngine: async (): Promise<never> => {
    throw new Error('images.engine "sharp" needs the optional `sharp` package');
  },
}));

it("fails readiness, under the images category, when the image engine cannot load", async () => {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const options = { database: db, storage } as unknown as ShelfOptions;
  const runtime = {
    config: { branchTtlDays: null },
    logger: pino({ level: "silent" }),
  } as unknown as ServerRuntime;
  const cell: LifecycleCell = {
    ready: Promise.resolve({ ok: true, failures: [] }),
    settled: null,
  };
  attachLifecycle({} as ShelfRouter, options, runtime, cell);
  const result = await cell.ready;
  expect(result.ok).toBe(false);
  expect(result.failures[0]).toMatchObject({ category: "images" });
  expect(result.failures[0]?.error).toMatch(/optional `sharp` package/u);
});
