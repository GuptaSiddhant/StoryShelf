import { createClient } from "@libsql/client";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createDrizzleAdapter } from "@storyshelf/core/adapter/database";
import { DDL } from "@storyshelf/core/ddl";
import { schema } from "@storyshelf/core/schema";
import { drizzle } from "drizzle-orm/libsql";

declare const __PKG_VERSION__: string | undefined;

const STORYBOOK_META_ALTER = "ALTER TABLE projects ADD COLUMN storybook_meta TEXT";

/**
 * Create a Turso/libSQL-backed DatabaseAdapter using Drizzle ORM.
 *
 * @param options - Connection options: the database `url` and an optional `authToken`.
 * @returns A DatabaseAdapter backed by the Turso database.
 */
export function createTursoDatabase(options: { url: string; authToken?: string }): DatabaseAdapter {
  const client = createClient({ url: options.url, authToken: options.authToken });
  const db = drizzle(client, { schema });

  return createDrizzleAdapter(db, {
    metadata: {
      name: "Turso",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Turso/libSQL database adapter",
      kind: "turso",
    },
    migrate: async () => {
      await client.executeMultiple(DDL);
      try {
        await client.execute(STORYBOOK_META_ALTER);
      } catch {
        // Column already exists — ignore
      }
    },
    close: () => {
      client.close();
    },
  });
}
