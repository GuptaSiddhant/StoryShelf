import { describe, expect, it } from "vitest";
import { commentsRebuildStatements } from "./comments-rebuild.ts";
import { DDL, tableColumns } from "./ddl.ts";

describe("commentsRebuildStatements", () => {
  const statements = commentsRebuildStatements();

  it("clears a copy an earlier failed run left behind, before building its own", () => {
    expect(statements[0]).toBe("DROP TABLE IF EXISTS comments_new");
  });

  it("creates the replacement from the current comments table, with a nullable user", () => {
    const [, create] = statements;

    expect(create).toMatch(/^CREATE TABLE comments_new \(/u);
    expect(create).toContain("user_id TEXT REFERENCES users(id)");
    expect(create).not.toContain("user_id TEXT NOT NULL");
    expect(create).toContain("story_id TEXT");
  });

  it("copies every column of the current table by name, so a longer old table cannot break the copy", () => {
    const names = (tableColumns(DDL).get("comments") ?? []).map(
      (column) => column.split(/\s+/u)[0],
    );
    const list = names.join(", ");

    expect(statements[2]).toBe(`INSERT INTO comments_new (${list}) SELECT ${list} FROM comments`);
    expect(names.length).toBeGreaterThan(10);
  });

  it("swaps the table in, then restores the index", () => {
    expect(statements.slice(3)).toEqual([
      "DROP TABLE comments",
      "ALTER TABLE comments_new RENAME TO comments",
      "CREATE INDEX IF NOT EXISTS comments_build_id_idx ON comments (build_id)",
    ]);
  });
});
