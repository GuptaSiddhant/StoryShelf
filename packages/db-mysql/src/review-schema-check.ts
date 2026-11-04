/**
 * Refuse an upgrade that cannot adopt a review or accessibility table or column made outside StoryShelf, with an
 * error that names the table and column instead of a raw driver message.
 */
import type { MigrationRunner } from "./migrate.ts";

/** Columns the review code needs in `build_reviews`. */
const BUILD_REVIEW_COLUMNS = ["id", "build_id", "user_id", "verdict", "body", "created_at"];

/** Columns the upgrade relies on, with the `information_schema` `data_type` each must have. */
const TYPED_COLUMNS = [
  { table: "projects", column: "review_enabled", type: "tinyint" },
  { table: "projects", column: "review_approvals", type: "int" },
  { table: "builds", column: "review_cycle", type: "int" },
  { table: "builds", column: "review_requested_cycle", type: "int" },
  // Accessibility columns (informational; a hand-made column of another type would break the upgrade).
  { table: "projects", column: "run_a11y", type: "tinyint" },
  { table: "snapshots", column: "a11y_violations", type: "text" },
  // An index on a TEXT build_id is refused by MySQL, so a hand-made table must use varchar.
  { table: "build_reviews", column: "build_id", type: "varchar" },
];

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
}

/** Aliased so the keys are lower case whatever the server's `information_schema` spells them. */
const COLUMNS_QUERY = `
  SELECT table_name AS table_name, column_name AS column_name, data_type AS data_type
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND (table_name = 'build_reviews'
      OR (table_name = 'projects' AND column_name IN ('review_enabled', 'review_approvals'))
      OR (table_name = 'builds' AND column_name IN ('review_cycle', 'review_requested_cycle'))
      OR (table_name = 'projects' AND column_name = 'run_a11y')
      OR (table_name = 'snapshots' AND column_name = 'a11y_violations'))
`;

function conflict(what: string): Error {
  return new Error(
    `Cannot upgrade the schema: ${what}. It was not created by StoryShelf; rename or drop it (keep a backup) and start again.`,
  );
}

/** Throw when `build_reviews` or a review column already exists in a shape the upgrade cannot use. */
export async function assertReviewSchema(run: MigrationRunner): Promise<void> {
  const rows = (await run(COLUMNS_QUERY)) as ColumnRow[];
  const reviews = new Set(
    rows
      .filter((row) => row.table_name === "build_reviews")
      .map((row) => row.column_name.toLowerCase()),
  );
  const missing =
    reviews.size > 0 ? BUILD_REVIEW_COLUMNS.find((name) => !reviews.has(name)) : undefined;
  if (missing !== undefined) {
    throw conflict(`table build_reviews has no column ${missing}`);
  }
  for (const { table, column, type } of TYPED_COLUMNS) {
    const found = rows.find(
      (row) => row.table_name === table && row.column_name.toLowerCase() === column,
    );
    if (found !== undefined && found.data_type.toLowerCase() !== type) {
      throw conflict(`column ${table}.${column} has type ${found.data_type}, expected ${type}`);
    }
  }
}
