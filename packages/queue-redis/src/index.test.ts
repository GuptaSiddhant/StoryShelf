import { describe, expect, it, vi } from "vitest";
import { createRedisCaptureQueue } from "./index.ts";

// oxlint-disable max-statements

type FakeRedis = {
  // oxlint-disable-next-line no-explicit-any
  [key: string]: any;
};

function makeFakeRedis(overrides: Record<string, unknown> = {}): {
  client: FakeRedis;
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const store: Record<string, string[]> = {};
  const zsets: Record<string, Map<string, number>> = {};

  const client: FakeRedis = {
    ping: vi.fn(async () => {
      calls.push({ method: "ping", args: [] });
      return "PONG";
    }),
    quit: vi.fn(async () => {
      calls.push({ method: "quit", args: [] });
      return "OK";
    }),
    lpush: vi.fn(async (key: string, value: string) => {
      calls.push({ method: "lpush", args: [key, value] });
      store[key] ??= [];
      store[key].unshift(value);
      return store[key].length;
    }),
    lrem: vi.fn(async (key: string, count: number, value: string) => {
      calls.push({ method: "lrem", args: [key, count, value] });
      if (!store[key]) return 0;
      const idx = store[key].indexOf(value);
      if (idx !== -1) {
        store[key].splice(idx, 1);
        return 1;
      }
      return 0;
    }),
    zadd: vi.fn(async (key: string, score: string, member: string) => {
      calls.push({ method: "zadd", args: [key, score, member] });
      zsets[key] ??= new Map();
      zsets[key].set(member, Number(score));
      return 1;
    }),
    zrangebyscore: vi.fn(async (key: string, min: number, max: number) => {
      calls.push({ method: "zrangebyscore", args: [key, min, max] });
      if (!zsets[key]) return [];
      const out: string[] = [];
      for (const [member, score] of zsets[key].entries()) {
        if (score >= min && score <= max) out.push(member);
      }
      return out;
    }),
    zrem: vi.fn(async (key: string, member: string) => {
      calls.push({ method: "zrem", args: [key, member] });
      if (!zsets[key]) return 0;
      return zsets[key].delete(member) ? 1 : 0;
    }),
    blmove: vi.fn(async (src: string, dst: string, _s: string, _d: string, _t: number) => {
      calls.push({ method: "blmove", args: [src, dst, _s, _d, _t] });
      if (overrides["blmove"]) {
        return (overrides["blmove"] as (a: unknown[]) => unknown)([src, dst, _s, _d, _t]) as
          | string
          | null;
      }
      if (!store[src] || store[src].length === 0) return null;
      const val = store[src].pop()!;
      store[dst] ??= [];
      store[dst].unshift(val);
      return val;
    }),
    brpoplpush: vi.fn(async (src: string, dst: string, _t: number) => {
      calls.push({ method: "brpoplpush", args: [src, dst, _t] });
      if (!store[src] || store[src].length === 0) return null;
      const val = store[src].pop()!;
      store[dst] ??= [];
      store[dst].unshift(val);
      return val;
    }),
    brpop: vi.fn(async (src: string, _t: number) => {
      calls.push({ method: "brpop", args: [src, _t] });
      if (!store[src] || store[src].length === 0) return null;
      const val = store[src].pop()!;
      return [src, val];
    }),
    pipeline: vi.fn(() => {
      const ops: { method: string; args: unknown[] }[] = [];
      const pipe: FakeRedis = {
        zrem: (k: string, m: string) => {
          ops.push({ method: "zrem", args: [k, m] });
          return pipe;
        },
        lpush: (k: string, v: string) => {
          ops.push({ method: "lpush", args: [k, v] });
          return pipe;
        },
        exec: async () => {
          calls.push({ method: "pipeline.exec", args: [ops] });
          for (const op of ops) {
            if (op.method === "zrem") {
              const [k, m] = op.args as [string, string];
              if (zsets[k]) zsets[k].delete(m);
            }
            if (op.method === "lpush") {
              const [k, v] = op.args as [string, string];
              store[k] ??= [];
              store[k].unshift(v as string);
            }
          }
          return [];
        },
      };
      return pipe;
    }),
    _store: store,
    _zsets: zsets,
  };

  // Allow overrides to replace methods
  for (const [k, v] of Object.entries(overrides)) {
    if (typeof v === "function" && k !== "blmove") {
      client[k] = vi.fn(async (...args: unknown[]) => {
        calls.push({ method: k, args });
        return (v as (...a: unknown[]) => unknown)(...args);
      });
    }
  }

  return { client, calls };
}

describe("enqueue", () => {
  it("enqueues a job via lpush", async () => {
    const { client, calls } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });

    await queue.enqueue({ buildId: "build-1", reqId: "req-1" });

    expect(calls.some((c) => c.method === "lpush")).toBe(true);
    const lpush = calls.find((c) => c.method === "lpush");
    expect(lpush?.args[0]).toBe("shelf:queue");
    const payload = JSON.parse(lpush?.args[1] as string) as Record<string, unknown>;
    expect(payload["buildId"]).toBe("build-1");
    expect(payload["reqId"]).toBe("req-1");
    expect(payload["attempts"]).toBe(0);
  });

  it("uses custom key", async () => {
    const { client, calls } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never, key: "my:queue" });

    await queue.enqueue({ buildId: "build-42" });

    expect(calls.find((c) => c.method === "lpush")?.args[0]).toBe("my:queue");
  });

  it("serializes queuedAt", async () => {
    const { client, calls } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });
    await queue.enqueue({ buildId: "build-1" });
    const payload = JSON.parse(
      calls.find((c) => c.method === "lpush")?.args[1] as string,
    ) as Record<string, unknown>;
    expect(typeof payload["queuedAt"]).toBe("string");
  });
});

describe("metadata and lifecycle", () => {
  it("has correct metadata", () => {
    const { client } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });
    expect(queue.metadata.kind).toBe("redis");
    expect(queue.metadata.category).toBe("capture-queue");
  });

  it("setup pings redis", async () => {
    const { client, calls } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });
    await queue.lifecycle?.setup({} as never);
    expect(calls.some((c) => c.method === "ping")).toBe(true);
  });

  it("teardown quits owned client, not external", async () => {
    const { client, calls } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });
    await queue.lifecycle?.teardown();
    // external client should not be quit
    expect(calls.some((c) => c.method === "quit")).toBe(false);
  });
});

describe("status/active/recent", () => {
  it("status returns null", async () => {
    const { client } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });
    expect(await queue.status("build-1")).toBeNull();
  });

  it("active returns empty", async () => {
    const { client } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });
    expect(await queue.active()).toEqual([]);
  });

  it("recent returns empty", async () => {
    const { client } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });
    expect(await queue.recent(5)).toEqual([]);
  });
});

describe("poll", () => {
  it("returns null when queue empty", async () => {
    const { client } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });
    expect(await queue.poll()).toBeNull();
  });

  it("returns job from queue", async () => {
    const { client } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });
    await queue.enqueue({ buildId: "build-1", reqId: "req-1" });
    const job = await queue.poll({ waitMs: 0 });
    expect(job?.buildId).toBe("build-1");
    expect(job?.reqId).toBe("req-1");
    expect(job?.attempts).toBe(0);
    expect(typeof job?.receipt).toBe("string");
  });

  it("returns null when message has no buildId", async () => {
    const { client } = makeFakeRedis({
      blmove: () => JSON.stringify({ foo: "bar" }),
    });
    // need to bypass lpush path, directly fake blmove
    const queue = createRedisCaptureQueue({ client: client as never });
    // inject malformed via blmove override
    const job = await queue.poll();
    expect(job).toBeNull();
  });

  it("handles malformed JSON", async () => {
    const { client, calls } = makeFakeRedis({
      blmove: () => "not-json",
    });
    const queue = createRedisCaptureQueue({ client: client as never });
    const job = await queue.poll();
    expect(job).toBeNull();
    expect(calls.some((c) => c.method === "lrem")).toBe(true);
  });

  it("promotes due delayed jobs before poll", async () => {
    const { client } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never, key: "test:queue" });
    // Simulate delayed job already due
    const payload = JSON.stringify({ buildId: "delayed-1", attempts: 1 });
    // Directly add to delayed ZSET via client
    await (
      client as unknown as { zadd: (k: string, s: string, m: string) => Promise<unknown> }
    ).zadd("test:queue:delayed", (Date.now() - 1000).toString(), payload);
    const job = await queue.poll({ waitMs: 0 });
    expect(job?.buildId).toBe("delayed-1");
    expect(job?.attempts).toBe(1);
  });

  it("clamps waitMs to 0-20 seconds", async () => {
    const { client, calls } = makeFakeRedis({
      blmove: () => null,
    });
    const queue = createRedisCaptureQueue({ client: client as never });
    await queue.poll({ waitMs: -5000 });
    expect(calls.find((c) => c.method === "blmove")?.args[4]).toBe(0);
    calls.length = 0;
    await queue.poll({ waitMs: 50_000 });
    expect(calls.find((c) => c.method === "blmove")?.args[4]).toBe(20);
  });

  it("uses custom waitTimeSeconds", async () => {
    const { client, calls } = makeFakeRedis({
      blmove: () => null,
    });
    const queue = createRedisCaptureQueue({
      client: client as never,
      waitTimeSeconds: 7,
    });
    await queue.poll();
    expect(calls.find((c) => c.method === "blmove")?.args[4]).toBe(7);
  });

  it("includes raw in poll result", async () => {
    const { client } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });
    await queue.enqueue({ buildId: "b1" });
    const job = await queue.poll({ waitMs: 0 });
    expect(job?.raw).toBeDefined();
  });

  it("falls back to brpoplpush when blmove missing", async () => {
    const store: Record<string, string[]> = {
      "shelf:queue": [JSON.stringify({ buildId: "fb-1" })],
    };
    const fake: FakeRedis = {
      ping: async () => "PONG",
      lpush: async (k: string, v: string) => {
        store[k] ??= [];
        store[k].unshift(v);
        return 1;
      },
      lrem: async () => 1,
      zrangebyscore: async () => [],
      zrem: async () => 1,
      zadd: async () => 1,
      pipeline: () => ({ exec: async () => [] }) as never,
      brpoplpush: async (src: string, dst: string) => {
        if (!store[src] || store[src].length === 0) return null;
        const v = store[src].pop()!;
        store[dst] ??= [];
        store[dst].unshift(v);
        return v;
      },
    };
    const queue = createRedisCaptureQueue({ client: fake as never });
    const job = await queue.poll({ waitMs: 0 });
    expect(job?.buildId).toBe("fb-1");
  });
});

describe("ack", () => {
  it("ack removes from processing", async () => {
    const { client, calls } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });
    await queue.enqueue({ buildId: "build-1" });
    const job = await queue.poll({ waitMs: 0 });
    expect(job).not.toBeNull();
    await queue.ack(job!);
    expect(calls.some((c) => c.method === "lrem" && c.args[0] === "shelf:queue:processing")).toBe(
      true,
    );
  });

  it("ack without receipt does nothing", async () => {
    const { client, calls } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });
    await queue.ack({ buildId: "b1" });
    expect(calls.some((c) => c.method === "lrem")).toBe(false);
  });
});

describe("nack", () => {
  it("nack with requeue pushes back to queue", async () => {
    const { client, calls } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });
    await queue.enqueue({ buildId: "build-1" });
    const job = await queue.poll({ waitMs: 0 });
    await queue.nack(job!, { requeue: true });
    // lrem + lpush
    expect(calls.some((c) => c.method === "lrem")).toBe(true);
    expect(calls.some((c) => c.method === "lpush" && c.args[0] === "shelf:queue")).toBe(true);
    // attempts incremented
    const lpush = calls.toReversed().find((c) => c.method === "lpush");
    const payload = JSON.parse(lpush?.args[1] as string) as Record<string, unknown>;
    expect(payload["attempts"]).toBe(1);
  });

  it("nack with delay adds to delayed ZSET", async () => {
    const { client, calls } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });
    await queue.enqueue({ buildId: "build-1" });
    const job = await queue.poll({ waitMs: 0 });
    await queue.nack(job!, { requeue: true, delayMs: 2000 });
    expect(calls.some((c) => c.method === "zadd")).toBe(true);
    const zadd = calls.find((c) => c.method === "zadd");
    expect(zadd?.args[0]).toBe("shelf:queue:delayed");
  });

  it("nack with requeue false deletes and does not push", async () => {
    const { client, calls } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });
    await queue.enqueue({ buildId: "build-1" });
    const job = await queue.poll({ waitMs: 0 });
    const before = calls.length;
    await queue.nack(job!, { requeue: false });
    const afterCalls = calls.slice(before);
    expect(afterCalls.some((c) => c.method === "lpush" && c.args[0] === "shelf:queue")).toBe(false);
    expect(afterCalls.some((c) => c.method === "zadd")).toBe(false);
  });

  it("nack without receipt does nothing", async () => {
    const { client, calls } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });
    await queue.nack({ buildId: "b1" }, { requeue: true });
    expect(calls.some((c) => c.method === "lrem")).toBe(false);
  });

  it("nack without options requeues immediately", async () => {
    const { client, calls } = makeFakeRedis();
    const queue = createRedisCaptureQueue({ client: client as never });
    await queue.enqueue({ buildId: "build-1" });
    const job = await queue.poll({ waitMs: 0 });
    await queue.nack(job!, {});
    expect(calls.some((c) => c.method === "lpush")).toBe(true);
  });
});
