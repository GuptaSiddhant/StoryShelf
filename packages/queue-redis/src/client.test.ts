/** Client construction and runtime resolution tests for the Redis queue. */
import { describe, expect, it, vi } from "vitest";
import { getRedisClient, resolveQueueRuntime } from "./client.ts";
import { createRedisCaptureQueue } from "./index.ts";

type FakeRedis = Record<string, unknown>;

/** Minimal fake recording pushes for key-threading assertions. */
function makeClient(): { client: FakeRedis; pushed: { key: string; value: string }[] } {
  const pushed: { key: string; value: string }[] = [];
  const client: FakeRedis = {
    ping: vi.fn(async () => "PONG"),
    lpush: vi.fn(async (key: string, value: string) => {
      pushed.push({ key, value });
      return pushed.length;
    }),
    zrangebyscore: vi.fn(async () => []),
    blmove: vi.fn(async () => null),
    lrem: vi.fn(async () => 0),
    pipeline: vi.fn(() => ({ exec: async () => [] }) as never),
  };
  return { client, pushed };
}

describe("getRedisClient", () => {
  it("returns the injected client as-is", () => {
    const { client } = makeClient();
    expect(getRedisClient({ client: client as never })).toBe(client);
  });
});

describe("resolveQueueRuntime", () => {
  it("derives default keys and waits", () => {
    const { client } = makeClient();
    const { rt, ownsClient } = resolveQueueRuntime({ client: client as never });
    expect(rt.key).toBe("shelf:queue");
    expect(rt.processingKey).toBe("shelf:queue:processing");
    expect(rt.delayedKey).toBe("shelf:queue:delayed");
    expect(rt.waitTimeSeconds).toBe(5);
    expect(ownsClient).toBe(false);
  });

  it("derives keys from a custom key and keeps explicit waits", () => {
    const { client } = makeClient();
    const { rt } = resolveQueueRuntime({
      client: client as never,
      key: "my:queue",
      waitTimeSeconds: 7,
    });
    expect(rt.key).toBe("my:queue");
    expect(rt.processingKey).toBe("my:queue:processing");
    expect(rt.delayedKey).toBe("my:queue:delayed");
    expect(rt.waitTimeSeconds).toBe(7);
  });
});

describe("queue key threading", () => {
  it("enqueues onto the default key", async () => {
    const { client, pushed } = makeClient();
    const queue = createRedisCaptureQueue({ client: client as never });
    await queue.enqueue({ buildId: "build-1" });
    expect(pushed[0]?.key).toBe("shelf:queue");
  });

  it("uses custom key", async () => {
    const { client, pushed } = makeClient();
    const queue = createRedisCaptureQueue({ client: client as never, key: "my:queue" });
    await queue.enqueue({ buildId: "build-42" });
    expect(pushed[0]?.key).toBe("my:queue");
  });
});
