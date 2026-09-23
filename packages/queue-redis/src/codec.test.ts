/** Job serialization tests: payloads, body parsing, and polled-job extraction. */
import type { Logger } from "@storyshelf/core/logger";
import { describe, expect, it, vi } from "vitest";
import { buildRequeuePayload, extractPolledJob, parseBody } from "./codec.ts";

type FakeRedis = Record<string, unknown>;

/** Minimal fake recording removals from the processing list. */
function makeClient(): { client: FakeRedis; removed: string[] } {
  const removed: string[] = [];
  const client: FakeRedis = {
    lrem: vi.fn(async (_key: string, _count: number, value: string) => {
      removed.push(value);
      return 1;
    }),
  };
  return { client, removed };
}

describe("parseBody", () => {
  it("parses valid JSON", () => {
    expect(parseBody(JSON.stringify({ buildId: "b1", attempts: 2 }))).toEqual({
      buildId: "b1",
      attempts: 2,
    });
  });

  it("returns empty for malformed JSON", () => {
    expect(parseBody("not-json")).toEqual({});
  });
});

describe("buildRequeuePayload", () => {
  it("increments attempts and preserves identifiers", () => {
    const payload = JSON.parse(
      buildRequeuePayload({ buildId: "b1", reqId: "r1", queuedAt: "2026-01-01", attempts: 1 }),
    ) as Record<string, unknown>;
    expect(payload["buildId"]).toBe("b1");
    expect(payload["reqId"]).toBe("r1");
    expect(payload["queuedAt"]).toBe("2026-01-01");
    expect(payload["status"]).toBe("queued");
    expect(payload["attempts"]).toBe(2);
  });

  it("defaults missing attempts and queuedAt", () => {
    const payload = JSON.parse(buildRequeuePayload({ buildId: "b1" })) as Record<string, unknown>;
    expect(payload["attempts"]).toBe(1);
    expect(typeof payload["queuedAt"]).toBe("string");
  });
});

describe("extractPolledJob", () => {
  it("returns null for null and empty payloads", async () => {
    const { client } = makeClient();
    await expect(extractPolledJob(client as never, "proc", null)).resolves.toBeNull();
    await expect(extractPolledJob(client as never, "proc", "")).resolves.toBeNull();
  });

  it("drops messages without buildId and warns", async () => {
    const { client, removed } = makeClient();
    const warn = vi.fn();
    const raw = JSON.stringify({ foo: "bar" });
    const job = await extractPolledJob(client as never, "proc", raw, {
      warn,
    } as unknown as Logger);
    expect(job).toBeNull();
    expect(removed).toEqual([raw]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("drops malformed JSON without a logger", async () => {
    const { client, removed } = makeClient();
    await expect(extractPolledJob(client as never, "proc", "not-json")).resolves.toBeNull();
    expect(removed).toEqual(["not-json"]);
  });

  it("returns job fields with attempts defaulting to zero", async () => {
    const { client } = makeClient();
    const raw = JSON.stringify({ buildId: "b1", reqId: "r1" });
    const job = await extractPolledJob(client as never, "proc", raw);
    expect(job).toMatchObject({ buildId: "b1", reqId: "r1", receipt: raw, attempts: 0, raw });
  });

  it("keeps stored attempts", async () => {
    const { client } = makeClient();
    const job = await extractPolledJob(
      client as never,
      "proc",
      JSON.stringify({ buildId: "b1", attempts: 3 }),
    );
    expect(job?.attempts).toBe(3);
  });
});
