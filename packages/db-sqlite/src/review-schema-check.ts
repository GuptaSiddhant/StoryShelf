/**
 * Refuse an upgrade that cannot adopt a review table or column made outside StoryShelf, with an
 * error that names the table and column instead of a raw driver message.
 */
import type { TableColumns, TableInfoReader } from "./table-info.ts";

/** Columns the review code needs in `build_reviews`. */
const BUILD_REVIEW_COLUMNS = ["id", "build_id", "user_id", "verdict", "body", "created_at"];

/** Integer columns the upgrade adds; one that exists with another type was made by hand. */
const INTEGER_COLUMNS = [
  ["projects", "review_enabled"],
  ["projects", "review_approvals"],
  ["builds", "review_cycle"],
  ["builds", "review_requested_cycle"],
] as const;

function conflict(what: string): Error {
  return new Error(
    `Cannot upgrade the review schema: ${what}. It was not created by StoryShelf; rename or drop it (keep a backup) and start again.`,
  );
}

/** The tables the check looks at. */
const REVIEW_TABLES = ["projects", "builds", "build_reviews"];

/** Throw when `build_reviews` or a review column already exists in a shape the upgrade cannot use. */
export function assertReviewColumns(tables: ReadonlyMap<string, TableColumns>): void {
  const reviews = tables.get("build_reviews") ?? new Map<string, string>();
  if (reviews.size > 0) {
    const missing = BUILD_REVIEW_COLUMNS.find((column) => !reviews.has(column));
    if (missing !== undefined) {
      throw conflict(`table build_reviews has no column ${missing}`);
    }
  }
  for (const [table, column] of INTEGER_COLUMNS) {
    const type = tables.get(table)?.get(column);
    if (type !== undefined && !type.startsWith("INT")) {
      throw conflict(`column ${table}.${column} has type ${type}, expected INTEGER`);
    }
  }
}

/**
 * Read the review tables through the preset's own reader, then check them. A reader that cannot
 * serve `PRAGMA` (a binding that refuses it) is the preset's to handle: it returns no columns, which
 * passes, so the check never blocks a database it cannot see.
 */
export async function assertReviewSchema(read: TableInfoReader): Promise<void> {
  const columns = await Promise.all(REVIEW_TABLES.map(async (table) => await read(table)));
  assertReviewColumns(
    new Map(REVIEW_TABLES.map((table, index) => [table, columns[index] ?? new Map()])),
  );
}
