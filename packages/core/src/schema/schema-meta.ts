/**
 * Row type of `schema_meta`: one row recording the release that last migrated the database
 * (ADR 0053, decision 2). Boot compares it with the running release before migrating.
 */

/** The single `schema_meta` row; `id` is always {@link SCHEMA_META_ID}. */
export interface SchemaMeta {
  /** Always `schema`: the table holds one row. */
  id: string;
  /** Release (`major.minor.patch`) that last ran the migrations. */
  version: string;
  /** When that release wrote the row. */
  migratedAt: string;
}

/** Primary key of the one `schema_meta` row. */
export const SCHEMA_META_ID = "schema";
