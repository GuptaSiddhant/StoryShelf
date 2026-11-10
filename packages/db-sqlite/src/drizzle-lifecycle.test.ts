import type { DrizzleAdapterOptions } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import { describe, expect, it, vi } from "vite-plus/test";
import { buildLifecycle } from "./drizzle-lifecycle.ts";

const logger = createShelfLogger({ level: "silent" });

function lifecycleOf(overrides: Partial<DrizzleAdapterOptions> = {}) {
  const migrate = vi.fn(async () => {});
  const close = vi.fn(async () => {});
  const options = { migrate, close, ...overrides } as unknown as DrizzleAdapterOptions;
  return { lifecycle: buildLifecycle(options), migrate, close };
}

describe("buildLifecycle", () => {
  it("migrates with the setup logger, and again on a second setup", async () => {
    const { lifecycle, migrate } = lifecycleOf();
    await lifecycle.setup({ config: {}, logger });
    await lifecycle.setup({ config: {}, logger });
    expect(migrate).toHaveBeenCalledTimes(2);
    expect(migrate).toHaveBeenCalledWith({ logger });
  });

  it("closes the driver once however often it is torn down", async () => {
    const { lifecycle, close } = lifecycleOf();
    await lifecycle.teardown();
    await lifecycle.teardown();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("is healthy until it is closed, pinging the driver when it can", async () => {
    const ping = vi.fn(async () => {});
    const { lifecycle } = lifecycleOf({ ping });
    expect(await lifecycle.health()).toEqual({ ok: true });
    expect(ping).toHaveBeenCalledTimes(1);
    await lifecycle.teardown();
    expect(await lifecycle.health()).toEqual({ ok: false, detail: "database closed" });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("reports healthy without a ping", async () => {
    const { lifecycle } = lifecycleOf();
    expect(await lifecycle.health()).toEqual({ ok: true });
  });

  it("surfaces a failed ping as an error", async () => {
    const ping = vi.fn(async () => {
      throw new Error("connection lost");
    });
    const { lifecycle } = lifecycleOf({ ping });
    await expect(lifecycle.health()).rejects.toThrow("connection lost");
  });
});
