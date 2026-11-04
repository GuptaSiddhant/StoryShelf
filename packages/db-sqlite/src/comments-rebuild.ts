/**
 * SQLite cannot drop `NOT NULL`, so a volume whose `comments.user_id` still has it (a table made
 * before anonymous comments) gets the table rebuilt. The new table is the current one from `DDL`,
 * not a frozen copy: a copy goes stale as columns are added, and a rebuild that copies the wrong
 * number of columns fails, which is what hid a rebuild that never ran. Internal: not part of the
 * published `@storyshelf/db-sqlite/ddl` surface.
 */
import { DDL, tableColumns } from "./ddl.ts";

const COMMENTS_TABLE = /CREATE TABLE IF NOT EXISTS comments \((?<body>[\s\S]*?)\n\);/u;

/**
 * The statements that swap `comments` for the current table, in order. Run them after
 * `ensureColumns` (the old table then has every column of the current one) and in one transaction.
 */
export function commentsRebuildStatements(): string[] {
  const body = COMMENTS_TABLE.exec(DDL)?.groups?.["body"];
  const columns = (tableColumns(DDL).get("comments") ?? []).map(
    (column) => column.split(/\s+/u)[0],
  );
  if (body === undefined || columns.length === 0) {
    throw new Error("the comments table is missing from the DDL");
  }
  const list = columns.join(", ");
  return [
    `CREATE TABLE comments_new (${body}\n)`,
    `INSERT INTO comments_new (${list}) SELECT ${list} FROM comments`,
    "DROP TABLE comments",
    "ALTER TABLE comments_new RENAME TO comments",
    "CREATE INDEX IF NOT EXISTS comments_build_id_idx ON comments (build_id)",
  ];
}
