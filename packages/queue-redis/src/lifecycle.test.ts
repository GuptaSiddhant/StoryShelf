/** Lifecycle setup/health/teardown tests for the Redis queue. */
import { describe, expect, it, vi } from "vitest";
import { createRedisCaptureQueue } from "./index.ts";
import { buildQueueLifecycle } from "./lifecycle.ts";

type FakeRedis = Record<string, unknown>;

/** Minimal fake recording ping/quit calls. */
function makeClient(): { client: FakeRedis; calls: string[] } {
  const calls: string[] = [];
  const client: FakeRedis = {
    ping: vi.fn(async () => {
      calls.push("ping");
      return "PONG";
    }),
    quit: vi.fn(async () => {
      calls.push("quit");
      return "OK";
    }),
  };
  return { client, calls };
}

describe("metadata and lifecycle", () => {
  it("has correct metadata", () => {
    const { client } = makeClient();
    const queue = createRedisCaptureQueue({ client: client as never });
    expect(queue.metadata.kind).toBe("redis");
    expect(queue.metadata.category).toBe("capture-queue");
  });

  it("setup pings redis", async () => {
    const { client, calls } = makeClient();
    const queue = createRedisCaptureQueue({ client: client as never });
    await queue.lifecycle?.setup({} as never);
    expect(calls).toContain("ping");
  });

  it("teardown quits owned client, not external", async () => {
    const { client, calls } = makeClient();
    const queue = createRedisCaptureQueue({ client: client as never });
    await queue.lifecycle?.teardown();
    // external client should not be quit
    expect(calls).not.toContain("quit");
  });

  it("health pings and returns ok", async () => {
    const { client, calls } = makeClient();
    const lifecycle = buildQueueLifecycle(client as never, false);
    await expect(lifecycle?.health?.()).resolves.toEqual({ ok: true });
    expect(calls).toContain("ping");
  });

  it("teardown quits the client when owned", async () => {
    const { client, calls } = makeClient();
    const lifecycle = buildQueueLifecycle(client as never, true);
    await lifecycle?.teardown?.();
    expect(calls).toContain("quit");
  });
});
