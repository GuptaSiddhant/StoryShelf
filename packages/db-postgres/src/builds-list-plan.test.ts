import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DDL } from "./ddl.ts";

let client: PGlite;

async function planOf(sql: string): Promise<string> {
  const result = await client.query<Record<string, string>>(`EXPLAIN ${sql}`);
  return result.rows.map((row) => Object.values(row).join(" ")).join("\n");
}

describe("builds list indexes", () => {
  beforeAll(async () => {
    client = new PGlite();
    await client.exec(DDL);
    // An empty table plans as a sequential scan; steer the planner to what a populated one picks.
    await client.exec("SET enable_seqscan = off; SET enable_bitmapscan = off;");
  });
  afterAll(async () => {
    await client.close();
  });

  it("serves a project's list in created order without a sort", async () => {
    const plan = await planOf(
      "SELECT * FROM builds WHERE project_id = 'p' ORDER BY created_at DESC LIMIT 20",
    );
    expect(plan).toContain("builds_project_created_idx");
    expect(plan).not.toContain("Sort");
  });

  it("serves a branch list in created order without a sort", async () => {
    const plan = await planOf(
      "SELECT * FROM builds WHERE project_id = 'p' AND git_branch = 'main' ORDER BY created_at DESC LIMIT 1",
    );
    expect(plan).toContain("builds_project_branch_created_idx");
    expect(plan).not.toContain("Sort");
  });
});
