/**
 * Refuse an upgrade that cannot adopt a review table or column made outside StoryShelf, with an
 * error that names the table and column instead of a raw driver message.
 */
import type { MigrationRunner } from "./migrate.ts";

/** Columns the review code needs in `build_reviews`. */
const BUILD_REVIEW_COLUMNS = ["id", "build_id", "verdict", "created_at"];

/** Columns the upgrade adds, with the `information_schema` type each must have. */
const TYPED_COLUMNS = [
  { table: "projects", column: "review_enabled", type: "boolean" },
  { table: "projects", column: "review_approvals", type: "integer" },
  { table: "builds", column: "review_cycle", type: "integer" },
  { table: "builds", column: "review_requested_cycle", type: "integer" },
];

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
}

const COLUMNS_QUERY = `
  SELECT table_name, column_name, data_type FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND (table_name = 'build_reviews'
      OR (table_name = 'projects' AND column_name IN ('review_enabled', 'review_approvals'))
      OR (table_name = 'builds' AND column_name IN ('review_cycle', 'review_requested_cycle')))
`;

function conflict(what: string): Error {
  return new Error(
    `Cannot upgrade the review schema: ${what}. It was not created by StoryShelf; rename or drop it (keep a backup) and start again.`,
  );
}

/** Throw when `build_reviews` or a review column already exists in a shape the upgrade cannot use. */
export async function assertReviewSchema(run: MigrationRunner): Promise<void> {
  const rows = (await run(COLUMNS_QUERY)) as ColumnRow[];
  const reviews = new Set(
    rows.filter((row) => row.table_name === "build_reviews").map((row) => row.column_name),
  );
  const missing =
    reviews.size > 0 ? BUILD_REVIEW_COLUMNS.find((name) => !reviews.has(name)) : undefined;
  if (missing !== undefined) {
    throw conflict(`table build_reviews has no column ${missing}`);
  }
  for (const { table, column, type } of TYPED_COLUMNS) {
    const found = rows.find((row) => row.table_name === table && row.column_name === column);
    if (found !== undefined && found.data_type !== type) {
      throw conflict(`column ${table}.${column} has type ${found.data_type}, expected ${type}`);
    }
  }
}
