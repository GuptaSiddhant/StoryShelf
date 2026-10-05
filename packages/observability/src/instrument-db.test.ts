import { SpanStatusCode } from "@opentelemetry/api";
import type { DatabaseAdapter, Tables } from "@storyshelf/core/adapter/database";
import type { Logger } from "@storyshelf/core/logger";
import type { SQL, Table } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstrumentedDatabase } from "./instrument-db.ts";
import { installTestTelemetry, type TestTelemetry } from "./test-setup.ts";

const fakeTable = sqliteTable("fake_things", {
  id: text("id").primaryKey(),
  count: integer("count"),
});

function createFakeDb(): DatabaseAdapter & { setLoggerMock: (logger: Logger) => void } {
  const setLoggerMock = vi.fn((_logger: Logger) => {});
  return {
    metadata: {
      name: "Fake DB",
      version: "0.0.0",
      kind: "fake",
      category: "database",
    },
    tables: {} as Tables,
    setLoggerMock,
    setLogger: setLoggerMock,
    insert: async <T extends Table>() => ({ id: "row-1" }) as T["$inferSelect"],
    update: async <T extends Table>() => ({ id: "row-1" }) as T["$inferSelect"],
    get: async <T extends Table>() => ({ id: "row-1" }) as T["$inferSelect"],
    remove: async () => {},
    list: async <T extends Table>() => [{ id: "row-1" }] as T["$inferSelect"][],
    count: async () => 1,
    all: async <T>() => [{ id: "row-1" }] as T[],
  };
}

describe("createInstrumentedDatabase", () => {
  let telemetry: TestTelemetry | undefined;

  afterEach(async () => {
    await telemetry?.cleanup();
    telemetry = undefined;
  });

  it("passes calls through with table spans", async () => {
    telemetry = installTestTelemetry();
    const db = createInstrumentedDatabase(createFakeDb());
    const row = await db.insert(fakeTable, { id: "row-1", count: 2 });
    expect(row).toEqual({ id: "row-1" });
    await db.count(fakeTable);
    await db.all<{ id: string }>({} as SQL);
    const spans = telemetry.exporter.getFinishedSpans();
    expect(spans.map((span) => span.name)).toEqual(["db.insert", "db.count", "db.all"]);
    expect(spans[0]?.attributes["db.table"]).toBe("fake_things");
  });

  it("marks failing operations ERROR and rethrows", async () => {
    telemetry = installTestTelemetry();
    const fake = createFakeDb();
    fake.get = async () => {
      throw new Error("db down");
    };
    const db = createInstrumentedDatabase(fake);
    await expect(db.get(fakeTable, "missing")).rejects.toThrow("db down");
    const spans = telemetry.exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("delegates identity, tables, and logger binding", () => {
    const fake = createFakeDb();
    const db = createInstrumentedDatabase(fake);
    expect(db.metadata).toBe(fake.metadata);
    expect(db.tables).toBe(fake.tables);
    expect(db.lifecycle).toBe(fake.lifecycle);
    const logger = { child: () => logger } as unknown as Logger;
    db.setLogger?.(logger);
    expect(fake.setLoggerMock).toHaveBeenCalledWith(logger);
  });
});
