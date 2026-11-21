import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DDL } from "./ddl.ts";

function planOf(sqlite: DatabaseSync, sql: string): string {
  const rows = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[];
  return rows.map((row) => row.detail).join("\n");
}

describe("builds list indexes", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(DDL);

  it("serves a project's list in created order without a sort", () => {
    const plan = planOf(
      sqlite,
      "SELECT * FROM builds WHERE project_id = 'p' ORDER BY created_at DESC LIMIT 20",
    );
    expect(plan).toContain("builds_project_created_idx");
    expect(plan).not.toContain("TEMP B-TREE");
  });

  it("serves a branch list in created order without a sort", () => {
    const plan = planOf(
      sqlite,
      "SELECT * FROM builds WHERE project_id = 'p' AND git_branch = 'main' ORDER BY created_at DESC LIMIT 1",
    );
    expect(plan).toContain("builds_project_branch_created_idx");
    expect(plan).not.toContain("TEMP B-TREE");
  });
});
