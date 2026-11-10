/** `AiUsageModel.reserve` on node:sqlite: parallel requests at the limit (#545). */
import { createShelfLogger } from "@storyshelf/core/logger";
import { AiUsageModel } from "@storyshelf/core/models";
import { expect, it } from "vite-plus/test";
import { createSqliteDatabase } from "./index.ts";

const silent = createShelfLogger({ level: "silent" });
const T0 = "2026-01-01T00:00:00.000Z";
const reservation = { projectId: "p1", profile: "default", task: "triage", model: "m" };

async function seeded() {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: silent });
  for (const id of ["p1", "p2"]) {
    // eslint-disable-next-line no-await-in-loop -- two rows, in order
    await db.insert(db.tables.projects, {
      id,
      name: id,
      slug: id,
      gitDefaultBranch: "main",
      createdAt: T0,
      updatedAt: T0,
    } as never);
  }
  return { db, usage: new AiUsageModel(db) };
}

it("lets exactly perProjectCallsPerHour of many parallel requests through", async () => {
  const { db, usage } = await seeded();
  const window = { since: new Date(Date.now() - 3_600_000).toISOString(), max: 5 };
  const results = await Promise.all(
    Array.from({ length: 25 }, async () => await usage.reserve(reservation, window)),
  );
  expect(results.filter((row) => row !== null)).toHaveLength(5);
  expect(await usage.countCalls("p1", window.since)).toBe(5);
  // Another project has its own window.
  expect(await usage.reserve({ ...reservation, projectId: "p2" }, window)).not.toBeNull();
  await db.lifecycle?.teardown();
});

it("keeps sequential usage totals unchanged: a settled reservation is one call with its tokens", async () => {
  const { db, usage } = await seeded();
  const window = { since: new Date(Date.now() - 3_600_000).toISOString(), max: 5 };
  const row = await usage.reserve(reservation, window);
  await usage.attach(row!.id, "i1");
  await usage.complete("i1", {
    insightId: "i1",
    ...reservation,
    inputTokens: 12,
    outputTokens: 3,
    estimated: false,
    images: 1,
    status: "ok",
  });
  const rows = await usage.listSince(T0);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: "ok", inputTokens: 12, outputTokens: 3, images: 1 });
  expect(await usage.countCalls("p1", window.since)).toBe(1);
  await db.lifecycle?.teardown();
});
