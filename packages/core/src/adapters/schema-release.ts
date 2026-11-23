import { sql } from "drizzle-orm";
import type { DatabaseAdapter } from "./database.ts";

/**
 * The release that last migrated the database (`schema_meta`), read without creating or changing
 * anything. `null` when the table or the row is not there: nothing has migrated it yet. Plain
 * standard SQL, the same on every dialect. A connection failure also reads as `null`; use `ping`
 * to tell the two apart.
 */
export async function readSchemaRelease(db: Pick<DatabaseAdapter, "all">): Promise<string | null> {
  try {
    // Rows come back as objects or as value arrays, depending on the driver.
    const rows = await db.all<{ version?: unknown } | unknown[]>(
      sql.raw("SELECT version FROM schema_meta WHERE id = 'schema'"),
    );
    const row = rows[0];
    const version = Array.isArray(row) ? row[0] : row?.version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}
