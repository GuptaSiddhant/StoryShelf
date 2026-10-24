import { describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.ts";

function recordingRunner(): { queries: string[]; run: (sql: string) => Promise<unknown[]> } {
  const queries: string[] = [];
  return {
    queries,
    run: async (sql) => {
      queries.push(sql);
      if (sql.includes("column_name = 'user_id'") && sql.includes("is_nullable")) {
        return [{ is_nullable: "NO" }];
      }
      return [];
    },
  };
}

describe("runMigrations: MySQL 8 compatibility", () => {
  it("splits the DDL and avoids Postgres-only and MariaDB-only syntax", async () => {
    const { queries, run } = recordingRunner();
    await runMigrations(run);

    expect(queries.some((sql) => sql.startsWith("CREATE TABLE IF NOT EXISTS projects"))).toBe(true);
    expect(queries.some((sql) => sql.includes("ADD COLUMN IF NOT EXISTS"))).toBe(false);
    expect(queries.some((sql) => sql.includes("CREATE INDEX IF NOT EXISTS"))).toBe(false);
    expect(queries.some((sql) => sql.includes("ALTER COLUMN"))).toBe(false);
    expect(queries.some((sql) => sql.includes("DROP INDEX") && sql.includes(" IF EXISTS"))).toBe(
      false,
    );
    expect(queries.some((sql) => sql.includes("TEXT PRIMARY KEY"))).toBe(false);
    expect(queries.some((sql) => sql.includes('"user"'))).toBe(false);
    expect(queries.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS `user`"))).toBe(true);
    expect(
      queries.some(
        (sql) =>
          sql.includes("CREATE TABLE IF NOT EXISTS label_types") &&
          sql.includes("`key` VARCHAR(255)"),
      ),
    ).toBe(true);
  });

  it("adds later columns and makes comment.user_id nullable with MODIFY", async () => {
    const { queries, run } = recordingRunner();
    await runMigrations(run);

    expect(queries).toContain(
      "ALTER TABLE projects ADD COLUMN review_enabled TINYINT(1) NOT NULL DEFAULT 1",
    );
    expect(queries).toContain("ALTER TABLE projects ADD COLUMN storybook_url_ttl_seconds INT");
    expect(queries).toContain("ALTER TABLE snapshots ADD COLUMN a11y_violations TEXT");
    expect(queries).toContain("ALTER TABLE comments ADD COLUMN story_id TEXT");
    expect(queries).toContain(
      "ALTER TABLE notification_channels ADD COLUMN last_error_at DATETIME(3)",
    );
    expect(queries).toContain("ALTER TABLE comments MODIFY COLUMN user_id VARCHAR(64) NULL");
  });
});
