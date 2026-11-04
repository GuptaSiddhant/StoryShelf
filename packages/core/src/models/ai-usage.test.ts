import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { AiUsageModel, type AiUsageInput } from "./ai-usage.ts";

const input = (over: Partial<AiUsageInput> = {}): AiUsageInput => ({
  insightId: null,
  projectId: "p1",
  profile: "default",
  task: "triage",
  model: "m",
  inputTokens: 10,
  outputTokens: 5,
  estimated: false,
  images: 0,
  status: "ok",
  ...over,
});

const reservation = { projectId: "p1", profile: "default", task: "triage", model: "m" };
const hourAgo = (): string => new Date(Date.now() - 3_600_000).toISOString();
const roomyWindow = (): { since: string; max: number } => ({ since: hourAgo(), max: 5 });

describe("AiUsageModel", () => {
  it("records, lists since a cutoff, and counts calls per project", async () => {
    const { db } = makeDatabase();
    const model = new AiUsageModel(db);
    await model.record(input());
    await model.record(input({ projectId: "p2" }));
    const since = new Date(Date.now() - 60_000).toISOString();
    expect(await model.listSince(since)).toHaveLength(2);
    expect(await model.countCalls("p1", since)).toBe(1);
    expect(await model.listSince(new Date(Date.now() + 60_000).toISOString())).toHaveLength(0);
  });

  it("pages through more rows than one page", async () => {
    const { db } = makeDatabase();
    const model = new AiUsageModel(db);
    await Promise.all(Array.from({ length: 510 }, () => model.record(input())));
    expect(await model.listSince("2000-01-01T00:00:00.000Z")).toHaveLength(510);
  });

  it("purges old rows", async () => {
    const { db } = makeDatabase();
    const model = new AiUsageModel(db);
    await model.record(input());
    expect(await model.purgeBefore(new Date(Date.now() + 60_000).toISOString())).toBe(1);
    expect(await model.listSince("2000-01-01T00:00:00.000Z")).toHaveLength(0);
  });

  describe("reserve", () => {
    it("lets exactly the allowed calls through when requests arrive together", async () => {
      const { db } = makeDatabase();
      const model = new AiUsageModel(db);
      const limit = { since: hourAgo(), max: 3 };
      const results = await Promise.all(
        Array.from({ length: 10 }, async () => await model.reserve(reservation, limit)),
      );
      expect(results.filter((row) => row !== null)).toHaveLength(3);
      expect(await model.countCalls("p1", limit.since)).toBe(3);
    });

    it("refuses every request at a limit of zero, and a later one still gets its turn after a refusal", async () => {
      const { db } = makeDatabase();
      const model = new AiUsageModel(db);
      expect(await model.reserve(reservation, { since: hourAgo(), max: 0 })).toBeNull();
      expect(await model.countCalls("p1", hourAgo())).toBe(0);
      expect(await model.reserve(reservation, { since: hourAgo(), max: 1 })).not.toBeNull();
      expect(await model.reserve(reservation, { since: hourAgo(), max: 1 })).toBeNull();
    });

    it("keeps serving the queue after a reservation throws", async () => {
      const { db } = makeDatabase();
      const model = new AiUsageModel(db);
      const insert = db.insert.bind(db);
      let failures = 1;
      db.insert = (async (...args: Parameters<typeof db.insert>) => {
        if (failures > 0) {
          failures -= 1;
          throw new Error("db down");
        }
        return await insert(...args);
      }) as typeof db.insert;
      const window = { since: hourAgo(), max: 2 };
      const results = await Promise.allSettled([
        model.reserve(reservation, window),
        model.reserve(reservation, window),
      ]);
      expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
    });

    it("counts earlier calls and other projects separately", async () => {
      const { db } = makeDatabase();
      const model = new AiUsageModel(db);
      const limit = { since: hourAgo(), max: 2 };
      await model.record(input());
      expect(await model.reserve(reservation, limit)).not.toBeNull();
      expect(await model.reserve(reservation, limit)).toBeNull();
      expect(await model.reserve({ ...reservation, projectId: "p2" }, limit)).not.toBeNull();
    });

    it("keeps the reservation as a pending call with no tokens", async () => {
      const { db } = makeDatabase();
      const model = new AiUsageModel(db);
      const row = await model.reserve(reservation, { since: hourAgo(), max: 1 });
      expect(row).toMatchObject({ status: "pending", inputTokens: 0, outputTokens: 0, images: 0 });
    });

    it("removes its own row when another writer filled the limit in between", async () => {
      const { db } = makeDatabase();
      const model = new AiUsageModel(db);
      const limit = { since: hourAgo(), max: 1 };
      // An older row (smaller id) appears after the count but before the rank check.
      const originalCount = db.count.bind(db);
      let calls = 0;
      db.count = async (...args: Parameters<typeof db.count>) => {
        calls += 1;
        if (calls === 2) {
          await db.insert(db.tables.aiUsage, {
            id: "0".repeat(26),
            insightId: null,
            ...reservation,
            inputTokens: 0,
            outputTokens: 0,
            estimated: false,
            images: 0,
            status: "pending",
            createdAt: new Date().toISOString(),
          });
        }
        return await originalCount(...args);
      };
      expect(await model.reserve(reservation, limit)).toBeNull();
      expect(await model.countCalls("p1", limit.since)).toBe(1);
    });
  });

  describe("settling a reservation", () => {
    it("fills in the tokens of the insight's pending row without adding a call", async () => {
      const { db } = makeDatabase();
      const model = new AiUsageModel(db);
      const row = await model.reserve(reservation, roomyWindow());
      await model.attach(row!.id, "i1");
      expect(await model.complete("i1", input({ insightId: "i1", inputTokens: 7 }))).toBe(true);
      const [stored] = await model.listSince("2000-01-01T00:00:00.000Z");
      expect(stored).toMatchObject({ status: "ok", inputTokens: 7, insightId: "i1" });
      expect(await model.countCalls("p1", roomyWindow().since)).toBe(1);
      expect(await model.complete("i1", input({ insightId: "i1" }))).toBe(false);
    });

    it("keeps a reservation as a failed call with zero tokens, or gives it back", async () => {
      const { db } = makeDatabase();
      const model = new AiUsageModel(db);
      const kept = await model.reserve(reservation, roomyWindow());
      await model.attach(kept!.id, "i1");
      await model.settleFailed("i1");
      await model.settleFailed("missing");
      const given = await model.reserve(reservation, roomyWindow());
      await model.release(given!.id);
      const rows = await model.listSince("2000-01-01T00:00:00.000Z");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "failed", inputTokens: 0, outputTokens: 0 });
    });
  });
});
