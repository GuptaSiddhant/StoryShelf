import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.ts";

/** Run SQL through PGlite as the shared migration runner does (multi-statement allowed). */
function runnerFor(client: PGlite): (sql: string) => Promise<unknown[]> {
  return async (sql) => {
    const results = await client.exec(sql);
    return results.flatMap((result) => result.rows);
  };
}

describe("runMigrations: pre-browser volume upgrade", () => {
  it("adds browser columns defaulting to chromium and swaps the unique indexes", async () => {
    const client = new PGlite();
    const run = runnerFor(client);
    await runMigrations(run);
    await client.exec(`
      DROP INDEX snapshots_build_story_mode_browser_idx;
      DROP INDEX baselines_project_story_mode_browser_branch_idx;
      ALTER TABLE snapshots DROP COLUMN browser;
      ALTER TABLE snapshots DROP COLUMN mode;
      ALTER TABLE baselines DROP COLUMN browser;
      ALTER TABLE baselines DROP COLUMN mode;
      ALTER TABLE projects DROP COLUMN browsers;
      ALTER TABLE projects DROP COLUMN modes_allowlist;
      CREATE UNIQUE INDEX snapshots_build_story_viewport_idx ON snapshots (build_id, story_id, viewport_name);
      CREATE UNIQUE INDEX baselines_project_story_viewport_branch_idx ON baselines (project_id, story_id, viewport_name, branch);
      INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', now(), now());
      INSERT INTO baselines (id, project_id, story_id, viewport_name, branch, screenshot_path, created_at, updated_at)
        VALUES ('b1', 'p', 's', 'desktop', 'main', 'x', now(), now());
    `);

    await runMigrations(run);
    await runMigrations(run); // idempotent

    const baselines = await client.query<{ browser: string }>("SELECT browser FROM baselines");
    expect(baselines.rows).toEqual([{ browser: "chromium" }]);
    const indexes = await client.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename IN ('snapshots', 'baselines')",
    );
    const names = indexes.rows.map((row) => row.indexname);
    expect(names).toContain("snapshots_build_story_mode_browser_idx");
    expect(names).toContain("baselines_project_story_mode_browser_branch_idx");
    expect(names).not.toContain("snapshots_build_story_viewport_idx");
    expect(names).not.toContain("baselines_project_story_viewport_branch_idx");

    const insert = (browser: string) =>
      client.exec(
        `INSERT INTO baselines (id, project_id, story_id, viewport_name, browser, branch, screenshot_path, created_at, updated_at)
         VALUES ('b-${browser}', 'p', 's', 'desktop', '${browser}', 'main', 'y', now(), now())`,
      );
    await expect(insert("firefox")).resolves.toBeDefined();
    await expect(insert("chromium")).rejects.toThrow();
    await client.close();
  }, 60_000);
});

describe("runMigrations: builds and projects gain later columns", () => {
  it("adds inherited_count, test_results and run_tests to older tables, with defaults", async () => {
    const client = new PGlite();
    const run = runnerFor(client);
    await runMigrations(run);
    await client.exec(`
      INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', now(), now());
      INSERT INTO builds (id, project_id, git_sha, git_branch, created_at, updated_at)
        VALUES ('b', 'p', 'abc', 'main', now(), now());
      ALTER TABLE builds DROP COLUMN inherited_count;
      ALTER TABLE builds DROP COLUMN test_results;
      ALTER TABLE projects DROP COLUMN run_tests;
    `);

    await runMigrations(run);
    await runMigrations(run); // idempotent

    const build = await client.query<{ inherited_count: number; test_results: string | null }>(
      "SELECT inherited_count, test_results FROM builds WHERE id = 'b'",
    );
    expect(build.rows).toEqual([{ inherited_count: 0, test_results: null }]);
    const project = await client.query<{ run_tests: boolean }>(
      "SELECT run_tests FROM projects WHERE id = 'p'",
    );
    expect(project.rows).toEqual([{ run_tests: false }]);
    await client.close();
  }, 60_000);
});
