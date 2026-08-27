import type { SQL } from "drizzle-orm";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";

export interface ListOptions {
  where?: SQL;
  orderBy?: SQL;
  limit?: number;
  offset?: number;
}

export interface DatabaseAdapter {
  insert<T extends AnySQLiteTable>(table: T, values: T["$inferInsert"]): Promise<T["$inferSelect"]>;
  update<T extends AnySQLiteTable>(
    table: T,
    id: string,
    values: Partial<T["$inferInsert"]>,
  ): Promise<T["$inferSelect"]>;
  get<T extends AnySQLiteTable>(table: T, id: string): Promise<T["$inferSelect"] | null>;
  remove(table: AnySQLiteTable, id: string): Promise<void>;
  list<T extends AnySQLiteTable>(table: T, opts?: ListOptions): Promise<T["$inferSelect"][]>;
  count(table: AnySQLiteTable, where?: SQL): Promise<number>;
  all<T>(query: SQL): Promise<T[]>;
  migrate(): Promise<void>;
  close(): Promise<void>;
}
