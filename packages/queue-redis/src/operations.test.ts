/** Server-side operation tests: enqueue payloads and remote no-ops. */
import { describe, expect, it, vi } from "vitest";
import { createRedisCaptureQueue } from "./index.ts";

type FakeRedis = Record<string, unknown>;

/** Minimal fake recording pushes onto the main queue. */
function makeClient(): { client: FakeRedis; pushed: { key: string; value: string }[] } {
  const pushed: { key: string; value: string }[] = [];
  const client: FakeRedis = {
    lpush: vi.fn(async (key: string, value: string) => {
      pushed.push({ key, value });
      return pushed.length;
    }),
  };
  return { client, pushed };
}

describe("enqueue", () => {
  it("enqueues a job via lpush", async () => {
    const { client, pushed } = makeClient();
    const queue = createRedisCaptureQueue({ client: client as never });

    await queue.enqueue({ buildId: "build-1", reqId: "req-1" });

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.key).toBe("shelf:queue");
    const payload = JSON.parse(pushed[0]?.value as string) as Record<string, unknown>;
    expect(payload["buildId"]).toBe("build-1");
    expect(payload["reqId"]).toBe("req-1");
    expect(payload["attempts"]).toBe(0);
  });

  it("serializes queuedAt", async () => {
    const { client, pushed } = makeClient();
    const queue = createRedisCaptureQueue({ client: client as never });
    await queue.enqueue({ buildId: "build-1" });
    const payload = JSON.parse(pushed[0]?.value as string) as Record<string, unknown>;
    expect(typeof payload["queuedAt"]).toBe("string");
  });
});

describe("status/active/recent", () => {
  it("status returns null", async () => {
    const { client } = makeClient();
    const queue = createRedisCaptureQueue({ client: client as never });
    expect(await queue.status("build-1")).toBeNull();
  });

  it("active returns empty", async () => {
    const { client } = makeClient();
    const queue = createRedisCaptureQueue({ client: client as never });
    expect(await queue.active()).toEqual([]);
  });

  it("recent returns empty", async () => {
    const { client } = makeClient();
    const queue = createRedisCaptureQueue({ client: client as never });
    expect(await queue.recent(5)).toEqual([]);
  });
});
