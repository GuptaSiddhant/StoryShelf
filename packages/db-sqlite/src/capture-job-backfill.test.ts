import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { CAPTURE_JOB_BACKFILL } from "./capture-job-backfill.ts";
import { DDL } from "./ddl.ts";

function database(): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(DDL);
  sqlite.exec(`
    INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', 't', 't');
    INSERT INTO builds (id, project_id, git_sha, git_branch, status, created_at, updated_at) VALUES
      ('one', 'p', 'a', 'main', 'capturing', 't', 't'),
      ('tie', 'p', 'b', 'main', 'pending', 't', 't');
    INSERT INTO capture_jobs (id, entry, job_id, kind, build_id, status, created_at, updated_at) VALUES
      ('j1', 'job', 'j1', 'capture', 'one', 'running', '2026-01-01', 't'),
      ('t1', 'job', 't1', 'capture', 'tie', 'queued', '2026-01-02', 't'),
      ('t2', 'job', 't2', 'capture', 'tie', 'queued', '2026-01-02', 't');
  `);
  return sqlite;
}

function owners(sqlite: DatabaseSync): Record<string, unknown> {
  const rows = sqlite.prepare("SELECT id, capture_job_id FROM builds").all() as {
    id: string;
    capture_job_id: string | null;
  }[];
  return Object.fromEntries(rows.map((row) => [row.id, row.capture_job_id]));
}

describe("CAPTURE_JOB_BACKFILL", () => {
  it("owns a build by its single newest job and leaves a tie unowned", () => {
    const sqlite = database();
    sqlite.exec(CAPTURE_JOB_BACKFILL);
    expect(owners(sqlite)).toEqual({ one: "j1", tie: null });
  });

  it("is idempotent and never overwrites an owner", () => {
    const sqlite = database();
    sqlite.exec(CAPTURE_JOB_BACKFILL);
    sqlite.exec("UPDATE builds SET capture_job_id = 'kept' WHERE id = 'one'");
    sqlite.exec(CAPTURE_JOB_BACKFILL);
    expect(owners(sqlite)).toEqual({ one: "kept", tie: null });
  });
});
