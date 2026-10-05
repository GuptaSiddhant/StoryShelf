/**
 * Database adapter wrapper: one span + duration metric per operation.
 *
 * Span names are `db.<operation>` with the table as an attribute (never in
 * the name). Adapter identity (`metadata`, `lifecycle`, `tables`) and the
 * host-bound logger delegate straight through, so health/setup behave
 * identically with or without observability.
 */
import type { DatabaseAdapter, ListOptions, Tables } from "@storyshelf/core/adapter/database";
import type { Logger } from "@storyshelf/core/logger";
import { addTiming } from "@storyshelf/core/utils";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { dbMetrics } from "./metrics.ts";
import { withSpan } from "./tracing.ts";

/**
 * Wrap a database adapter with per-operation spans and metrics.
 *
 * @param db - The adapter to wrap (never mutated).
 * @returns A transparent adapter emitting `db.*` telemetry.
 */
export function createInstrumentedDatabase(db: DatabaseAdapter): DatabaseAdapter {
  return new InstrumentedDatabase(db);
}

class InstrumentedDatabase implements DatabaseAdapter {
  constructor(private readonly inner: DatabaseAdapter) {}

  get metadata(): DatabaseAdapter["metadata"] {
    return this.inner.metadata;
  }

  get lifecycle(): DatabaseAdapter["lifecycle"] {
    return this.inner.lifecycle;
  }

  get tables(): Tables {
    return this.inner.tables;
  }

  setLogger(logger: Logger): void {
    this.inner.setLogger?.(logger);
  }

  async insert<T extends Table>(table: T, values: T["$inferInsert"]): Promise<T["$inferSelect"]> {
    return await track("db.insert", table, async () => await this.inner.insert(table, values));
  }

  async update<T extends Table>(
    table: T,
    id: string,
    values: Partial<T["$inferInsert"]>,
  ): Promise<T["$inferSelect"]> {
    return await track("db.update", table, async () => await this.inner.update(table, id, values));
  }

  async get<T extends Table>(table: T, id: string): Promise<T["$inferSelect"] | null> {
    return await track("db.get", table, async () => await this.inner.get(table, id));
  }

  async remove(table: Table, id: string): Promise<void> {
    await track("db.remove", table, async () => {
      await this.inner.remove(table, id);
    });
  }

  async list<T extends Table>(table: T, opts?: ListOptions): Promise<T["$inferSelect"][]> {
    return await track("db.list", table, async () => await this.inner.list(table, opts));
  }

  async count(table: Table, where?: SQL): Promise<number> {
    return await track("db.count", table, async () => await this.inner.count(table, where));
  }

  async all<T>(query: SQL): Promise<T[]> {
    return await trackQuery("db.all", async () => await this.inner.all<T>(query));
  }
}

/** Run a table operation inside a span with a duration measurement. */
async function track<T>(operation: string, table: Table, fn: () => Promise<T>): Promise<T> {
  const tableName = getTableName(table);
  const start = performance.now();
  try {
    return await withSpan(operation, fn, { "db.table": tableName });
  } finally {
    const durationMs = performance.now() - start;
    addTiming("db", durationMs);
    dbMetrics().operationDuration.record(durationMs, {
      "db.operation": operation,
      "db.table": tableName,
    });
  }
}

/** Run a table-less query inside a span with a duration measurement. */
async function trackQuery<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await withSpan(operation, fn);
  } finally {
    const durationMs = performance.now() - start;
    addTiming("db", durationMs);
    dbMetrics().operationDuration.record(durationMs, {
      "db.operation": operation,
    });
  }
}
