/**
 * Refuse an upgrade that cannot adopt a review table or column made outside StoryShelf, with an
 * error that names the table and column instead of a raw driver message.
 */
import type { DatabaseSync } from "node:sqlite";

/** Columns the review code needs in `build_reviews`. */
const BUILD_REVIEW_COLUMNS = ["id", "build_id", "user_id", "verdict", "body", "created_at"];

/** Integer columns the upgrade adds; one that exists with another type was made by hand. */
const INTEGER_COLUMNS = [
  ["projects", "review_enabled"],
  ["projects", "review_approvals"],
  ["builds", "review_cycle"],
  ["builds", "review_requested_cycle"],
] as const;

type Columns = Map<string, string>;

/** `PRAGMA table_info` rows are `[cid, name, type, ...]` (the adapter opens with `returnArrays`). */
function columnsOf(sqlite: DatabaseSync, table: string): Columns {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as unknown as unknown[][];
  return new Map(rows.map((row) => [String(row[1]), String(row[2]).toUpperCase()]));
}

function conflict(what: string): Error {
  return new Error(
    `Cannot upgrade the review schema: ${what}. It was not created by StoryShelf; rename or drop it (keep a backup) and start again.`,
  );
}

/** Throw when `build_reviews` or a review column already exists in a shape the upgrade cannot use. */
export function assertReviewSchema(sqlite: DatabaseSync): void {
  const reviews = columnsOf(sqlite, "build_reviews");
  if (reviews.size > 0) {
    const missing = BUILD_REVIEW_COLUMNS.find((column) => !reviews.has(column));
    if (missing !== undefined) {
      throw conflict(`table build_reviews has no column ${missing}`);
    }
  }
  for (const [table, column] of INTEGER_COLUMNS) {
    const type = columnsOf(sqlite, table).get(column);
    if (type !== undefined && !type.startsWith("INT")) {
      throw conflict(`column ${table}.${column} has type ${type}, expected INTEGER`);
    }
  }
}
