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

describe("runMigrations: run_a11y default", () => {
  it("restores the default on an existing column", async () => {
    const client = new PGlite();
    const run = runnerFor(client);
    await runMigrations(run);
    await client.exec("ALTER TABLE projects ALTER COLUMN run_a11y SET DEFAULT false");

    await runMigrations(run);

    const columns = await client.query<{ column_default: string | null }>(
      "SELECT column_default FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'run_a11y'",
    );
    expect(columns.rows).toEqual([{ column_default: "true" }]);
    await client.close();
  }, 60_000);
});

describe("runMigrations: an existing run_a11y = false", () => {
  it("survives every later migration, and so do the stored findings", async () => {
    const client = new PGlite();
    const run = runnerFor(client);
    await runMigrations(run);
    await client.exec(`
      INSERT INTO projects (id, name, slug, run_a11y, created_at, updated_at)
        VALUES ('off', 'Off', 'off', false, now(), now());
    `);

    await runMigrations(run);
    await runMigrations(run);

    const rows = await client.query<{ run_a11y: boolean }>(
      "SELECT run_a11y FROM projects WHERE id = 'off'",
    );
    expect(rows.rows).toEqual([{ run_a11y: false }]);
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

describe("runMigrations: builds gain the review cycle columns", () => {
  it("adds review_cycle (default 0) and review_requested_cycle (null) to older builds", async () => {
    const client = new PGlite();
    const run = runnerFor(client);
    await runMigrations(run);
    await client.exec(`
      INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', now(), now());
      INSERT INTO builds (id, project_id, git_sha, git_branch, created_at, updated_at)
        VALUES ('b', 'p', 'abc', 'main', now(), now());
      ALTER TABLE builds DROP COLUMN review_cycle;
      ALTER TABLE builds DROP COLUMN review_requested_cycle;
    `);

    await runMigrations(run);
    await runMigrations(run); // idempotent

    const build = await client.query<{
      review_cycle: number;
      review_requested_cycle: number | null;
    }>("SELECT review_cycle, review_requested_cycle FROM builds WHERE id = 'b'");
    expect(build.rows).toEqual([{ review_cycle: 0, review_requested_cycle: null }]);
    await client.close();
  }, 60_000);
});

describe("runMigrations: subscriptions gain review_requests", () => {
  it("gives every existing subscription review requests on, and is idempotent", async () => {
    const client = new PGlite();
    const run = runnerFor(client);
    await runMigrations(run);
    await client.exec(`
      INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', now(), now());
      INSERT INTO users (id, email, name, created_at)
        VALUES ('u', 'u@example.com', 'U', now());
      INSERT INTO notification_subscriptions (id, project_id, user_id, enabled, created_at)
        VALUES ('s', 'p', 'u', false, now());
      ALTER TABLE notification_subscriptions DROP COLUMN review_requests;
    `);

    await runMigrations(run);
    await runMigrations(run);

    const rows = await client.query<{ enabled: boolean; review_requests: boolean }>(
      "SELECT enabled, review_requests FROM notification_subscriptions WHERE id = 's'",
    );
    expect(rows.rows).toEqual([{ enabled: false, review_requests: true }]);
    await client.close();
  }, 60_000);
});

describe("runMigrations: review, a11y, comment and notification columns", () => {
  it("back-fills every later column on older tables with the current defaults", async () => {
    const client = new PGlite();
    const run = runnerFor(client);
    await runMigrations(run);
    await client.exec(`
      INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', now(), now());
      INSERT INTO notification_channels (id, project_id, provider, config, created_at, updated_at)
        VALUES ('n', 'p', 'slack', '{}', now(), now());
      ALTER TABLE projects DROP COLUMN run_a11y;
      ALTER TABLE projects DROP COLUMN review_enabled;
      ALTER TABLE projects DROP COLUMN review_approvals;
      ALTER TABLE projects DROP COLUMN storybook_url_ttl_seconds;
      ALTER TABLE snapshots DROP COLUMN duration_ms;
      ALTER TABLE snapshots DROP COLUMN a11y_violations;
      ALTER TABLE comments DROP COLUMN story_id;
      ALTER TABLE comments DROP COLUMN mentions;
      ALTER TABLE comments DROP COLUMN kind;
      ALTER TABLE comments DROP COLUMN resolved_at;
      ALTER TABLE comments DROP COLUMN resolved_by;
      ALTER TABLE notification_channels DROP COLUMN last_error;
      ALTER TABLE notification_channels DROP COLUMN last_error_at;
      ALTER TABLE notification_channels DROP COLUMN last_delivered_at;
    `);

    await runMigrations(run);
    await runMigrations(run); // idempotent

    const project = await client.query<{
      run_a11y: boolean;
      review_enabled: boolean;
      review_approvals: number;
      storybook_url_ttl_seconds: number | null;
    }>(
      "SELECT run_a11y, review_enabled, review_approvals, storybook_url_ttl_seconds FROM projects WHERE id = 'p'",
    );
    expect(project.rows).toEqual([
      {
        run_a11y: true,
        review_enabled: true,
        review_approvals: 1,
        storybook_url_ttl_seconds: null,
      },
    ]);

    const columns = await client.query<{ table_name: string; column_name: string }>(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE (table_name = 'snapshots' AND column_name IN ('duration_ms', 'a11y_violations'))
         OR (table_name = 'comments' AND column_name IN ('story_id', 'mentions', 'kind', 'resolved_at', 'resolved_by'))
         OR (table_name = 'notification_channels' AND column_name IN ('last_error', 'last_error_at', 'last_delivered_at'))
      ORDER BY table_name, column_name
    `);
    expect(columns.rows.map((row) => `${row.table_name}.${row.column_name}`)).toEqual([
      "comments.kind",
      "comments.mentions",
      "comments.resolved_at",
      "comments.resolved_by",
      "comments.story_id",
      "notification_channels.last_delivered_at",
      "notification_channels.last_error",
      "notification_channels.last_error_at",
      "snapshots.a11y_violations",
      "snapshots.duration_ms",
    ]);
    await client.close();
  }, 60_000);
});

/** Put `users` back to its pre-fix shape (no auth columns) and keep one existing account in it. */
async function downgradeUsers(client: PGlite): Promise<void> {
  await client.exec(`
    ALTER TABLE users DROP COLUMN password_hash;
    ALTER TABLE users DROP COLUMN display_name_override;
    ALTER TABLE users DROP COLUMN auth_provider;
    ALTER TABLE users DROP COLUMN disabled;
    INSERT INTO users (id, email, name, role, created_at)
      VALUES ('u1', 'old@example.com', 'Old', 'admin', now());
  `);
}

/** Column name, type, default and nullability of `users`, ordered by column name. */
async function usersShape(client: PGlite): Promise<unknown[]> {
  const result = await client.query(`
    SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns
    WHERE table_name = 'users' ORDER BY column_name
  `);
  return result.rows;
}

describe("runMigrations: users auth columns", () => {
  const AUTH_COLUMNS = "password_hash, display_name_override, auth_provider, disabled";

  it("creates the columns with their defaults on a fresh database", async () => {
    const client = new PGlite();
    await runMigrations(runnerFor(client));
    await client.exec(
      "INSERT INTO users (id, email, name, created_at) VALUES ('u', 'u@example.com', 'U', now())",
    );
    const rows = await client.query<Record<string, unknown>>(`SELECT ${AUTH_COLUMNS} FROM users`);
    expect(rows.rows).toEqual([
      {
        password_hash: null,
        display_name_override: null,
        auth_provider: "oidc",
        disabled: false,
      },
    ]);
    await client.close();
  }, 60_000);

  it("adds the columns to an existing users table and leaves its rows unchanged", async () => {
    const client = new PGlite();
    const run = runnerFor(client);
    await runMigrations(run);
    await downgradeUsers(client);

    await runMigrations(run);
    await runMigrations(run); // idempotent

    const rows = await client.query<Record<string, unknown>>(
      `SELECT id, email, name, role, ${AUTH_COLUMNS} FROM users`,
    );
    expect(rows.rows).toEqual([
      {
        id: "u1",
        email: "old@example.com",
        name: "Old",
        role: "admin",
        password_hash: null,
        display_name_override: null,
        auth_provider: "oidc",
        disabled: false,
      },
    ]);
    // The upgraded table can now store the flag (this is the update that used to fail).
    await client.exec("UPDATE users SET disabled = true WHERE id = 'u1'");
    const flag = await client.query<{ disabled: boolean }>("SELECT disabled FROM users");
    expect(flag.rows).toEqual([{ disabled: true }]);
    await client.close();
  }, 60_000);

  it("gives an upgraded users table the same columns as a fresh one", async () => {
    const fresh = new PGlite();
    await runMigrations(runnerFor(fresh));
    const upgraded = new PGlite();
    const run = runnerFor(upgraded);
    await runMigrations(run);
    await downgradeUsers(upgraded);
    await runMigrations(run);

    // Guards the two copies of each definition (new-install DDL and upgrade ALTER) against drift.
    expect(await usersShape(upgraded)).toEqual(await usersShape(fresh));
    await fresh.close();
    await upgraded.close();
  }, 60_000);

  it("fails the boot instead of silently skipping when the columns cannot be added", async () => {
    const client = new PGlite();
    const inner = runnerFor(client);
    const failing = async (sql: string): Promise<unknown[]> => {
      if (sql.startsWith("ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled")) {
        throw new Error("permission denied for table users");
      }
      return await inner(sql);
    };
    await expect(runMigrations(failing)).rejects.toThrow("permission denied for table users");
    await client.close();
  }, 60_000);
});

async function downgradeCaptureJobs(client: PGlite): Promise<void> {
  await client.exec(`
    DROP INDEX capture_jobs_active_key_idx;
    ALTER TABLE capture_jobs DROP COLUMN active_key;
    ALTER TABLE capture_jobs DROP COLUMN rerun_requested_at;
    INSERT INTO capture_jobs (id, entry, job_id, kind, status, created_at, updated_at)
      VALUES ('j1', 'job', 'j1', 'notify', 'queued', now(), now()),
             ('j2', 'job', 'j2', 'notify', 'queued', now(), now());
  `);
}

async function captureJobsShape(client: PGlite): Promise<unknown[]> {
  const columns = await client.query(`
    SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns
    WHERE table_name = 'capture_jobs' ORDER BY column_name
  `);
  const indexes = await client.query(`
    SELECT indexdef FROM pg_indexes WHERE tablename = 'capture_jobs' ORDER BY indexname
  `);
  return [...columns.rows, ...indexes.rows];
}

describe("runMigrations: capture_jobs single-flight key", () => {
  it("adds the key columns and its unique index to an existing table, keeping its rows", async () => {
    const client = new PGlite();
    const run = runnerFor(client);
    await runMigrations(run);
    await downgradeCaptureJobs(client);

    await runMigrations(run);
    await runMigrations(run); // idempotent

    const rows = await client.query<Record<string, unknown>>(
      "SELECT id, active_key, rerun_requested_at FROM capture_jobs ORDER BY id",
    );
    expect(rows.rows).toEqual([
      { id: "j1", active_key: null, rerun_requested_at: null },
      { id: "j2", active_key: null, rerun_requested_at: null },
    ]);
    // Many rows without a key coexist; two with the same key do not.
    await client.exec("UPDATE capture_jobs SET active_key = 'notify:c:b' WHERE id = 'j1'");
    await expect(
      client.exec("UPDATE capture_jobs SET active_key = 'notify:c:b' WHERE id = 'j2'"),
    ).rejects.toThrow(/duplicate key|unique/iu);
    await client.close();
  }, 60_000);

  it("gives an upgraded table the same columns and indexes as a fresh one", async () => {
    const fresh = new PGlite();
    await runMigrations(runnerFor(fresh));
    const upgraded = new PGlite();
    const run = runnerFor(upgraded);
    await runMigrations(run);
    await downgradeCaptureJobs(upgraded);
    await runMigrations(run);

    expect(await captureJobsShape(upgraded)).toEqual(await captureJobsShape(fresh));
    await fresh.close();
    await upgraded.close();
  }, 60_000);

  it("fails the boot when the unique index cannot be created", async () => {
    const client = new PGlite();
    const inner = runnerFor(client);
    const failing = async (sql: string): Promise<unknown[]> => {
      if (sql.startsWith("CREATE UNIQUE INDEX IF NOT EXISTS capture_jobs_active_key_idx")) {
        throw new Error("permission denied for table capture_jobs");
      }
      return await inner(sql);
    };
    await expect(runMigrations(failing)).rejects.toThrow(
      "permission denied for table capture_jobs",
    );
    await client.close();
  }, 60_000);
});

describe("runMigrations: builds.capture_job_id", () => {
  it("gives a pending or capturing build the newest unfinished capture job of its own", async () => {
    const client = new PGlite();
    const run = runnerFor(client);
    await runMigrations(run);
    await client.exec(`
      INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', now(), now());
      INSERT INTO builds (id, project_id, git_sha, git_branch, status, created_at, updated_at) VALUES
        ('run', 'p', 'a', 'main', 'capturing', now(), now()),
        ('old', 'p', 'b', 'main', 'pending', now(), now()),
        ('none', 'p', 'c', 'main', 'pending', now(), now()),
        ('cancelled', 'p', 'e', 'main', 'pending', now(), now()),
        ('tie', 'p', 'f', 'main', 'pending', now(), now()),
        ('many', 'p', 'g', 'main', 'pending', now(), now()),
        ('done', 'p', 'd', 'main', 'passed', now(), now());
      INSERT INTO capture_jobs (id, entry, job_id, kind, build_id, shard_id, status, created_at, updated_at) VALUES
        ('j1', 'job', 'j1', 'capture', 'run', NULL, 'running', '2026-01-01', '2026-01-01'),
        ('j1:1', 'attempt', 'j1', 'capture', 'run', NULL, 'running', '2026-01-02', '2026-01-02'),
        ('j2', 'job', 'j2', 'capture', 'old', NULL, 'failed', '2026-01-01', '2026-01-01'),
        ('j3', 'job', 'j3', 'capture', 'old', NULL, 'queued', '2026-01-02', '2026-01-02'),
        ('s1', 'job', 's1', 'capture', 'run', 'shard', 'queued', '2026-01-03', '2026-01-03'),
        ('j4', 'job', 'j4', 'capture', 'done', NULL, 'queued', '2026-01-01', '2026-01-01'),
        ('j5', 'job', 'j5', 'capture', 'cancelled', NULL, 'running', '2026-01-01', '2026-01-01');
      INSERT INTO capture_jobs (id, entry, job_id, kind, build_id, shard_id, status, created_at, updated_at) VALUES
        ('t1', 'job', 't1', 'capture', 'tie', NULL, 'queued', '2026-01-05', '2026-01-05'),
        ('t2', 'job', 't2', 'capture', 'tie', NULL, 'queued', '2026-01-05', '2026-01-05'),
        ('m1', 'job', 'm1', 'capture', 'many', NULL, 'queued', '2026-01-01', '2026-01-01'),
        ('m2', 'job', 'm2', 'capture', 'many', NULL, 'queued', '2026-01-09', '2026-01-09');
      UPDATE capture_jobs SET cancel_requested_at = now() WHERE id = 'j5';
      ALTER TABLE builds DROP COLUMN capture_job_id;
    `);

    await runMigrations(run);
    await runMigrations(run); // idempotent

    const rows = await client.query<{ id: string; capture_job_id: string | null }>(
      "SELECT id, capture_job_id FROM builds ORDER BY id",
    );
    expect(rows.rows).toEqual([
      { id: "cancelled", capture_job_id: null },
      { id: "done", capture_job_id: null },
      { id: "many", capture_job_id: null },
      { id: "none", capture_job_id: null },
      { id: "old", capture_job_id: "j3" },
      { id: "run", capture_job_id: "j1" },
      { id: "tie", capture_job_id: null },
    ]);
  }, 60_000);
});

describe("runMigrations: a failing build-column ALTER stops the boot", () => {
  it.each(["review_cycle", "review_requested_cycle", "capture_job_id", "capture_generation"])(
    "does not swallow a failure adding builds.%s",
    async (column) => {
      const client = new PGlite();
      const inner = runnerFor(client);
      const failing = async (sql: string): Promise<unknown[]> => {
        if (sql.startsWith(`ALTER TABLE builds ADD COLUMN IF NOT EXISTS ${column} `)) {
          throw new Error(`permission denied for table builds (${column})`);
        }
        return await inner(sql);
      };
      await expect(runMigrations(failing)).rejects.toThrow(
        `permission denied for table builds (${column})`,
      );
      await client.close();
    },
    60_000,
  );
});

describe("runMigrations: builds.capture_generation", () => {
  it("adds the run generation at 0 to existing builds, and again without harm", async () => {
    const client = new PGlite();
    const run = runnerFor(client);
    await runMigrations(run);
    await client.exec(`
      INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', now(), now());
      INSERT INTO builds (id, project_id, git_sha, git_branch, status, created_at, updated_at) VALUES
        ('b', 'p', 'a', 'main', 'capturing', now(), now());
      ALTER TABLE builds DROP COLUMN capture_generation;
    `);

    await runMigrations(run);
    await runMigrations(run); // idempotent

    const rows = await client.query<{ capture_generation: number }>(
      "SELECT capture_generation FROM builds WHERE id = 'b'",
    );
    expect(rows.rows).toEqual([{ capture_generation: 0 }]);
  }, 60_000);
});

/** Every distinct statement a clean run issues, in order. */
async function statementsOfARun(): Promise<string[]> {
  const seen: string[] = [];
  await runMigrations(async (sql) => {
    seen.push(sql);
    return await Promise.resolve([]);
  });
  return [...new Set(seen)];
}

/** A runner that fails the statement `target` with `error` and does nothing else. */
const failing = (target: string, error: unknown) => async (sql: string) => {
  if (sql === target) throw error;
  return await Promise.resolve([] as unknown[]);
};

describe("runMigrations: a failing statement stops the boot", () => {
  it("fails on any statement that errors, whichever column or index it adds", async () => {
    const statements = await statementsOfARun();
    expect(statements.length).toBeGreaterThan(80);

    const outcomes = await Promise.all(
      statements.map(
        async (target) =>
          await runMigrations(failing(target, new Error("boom"))).then(
            () => `${target} did not fail the boot`,
            () => "failed",
          ),
      ),
    );

    expect(outcomes.filter((outcome) => outcome !== "failed")).toEqual([]);
  });

  it("skips a unique index that existing duplicates prevent, and only for that error", async () => {
    const statements = await statementsOfARun();
    const uniqueIndexes = statements.filter(
      (sql) =>
        sql.startsWith("CREATE UNIQUE INDEX") && !sql.includes("capture_jobs_active_key_idx"),
    );
    expect(uniqueIndexes.length).toBeGreaterThanOrEqual(3);

    for (const target of uniqueIndexes) {
      // oxlint-disable-next-line no-await-in-loop -- one statement at a time
      await expect(
        runMigrations(failing(target, Object.assign(new Error("duplicate"), { code: "23505" }))),
      ).resolves.toBeUndefined();
      // oxlint-disable-next-line no-await-in-loop -- see above
      await expect(
        runMigrations(failing(target, Object.assign(new Error("denied"), { code: "42501" }))),
      ).rejects.toThrow("denied");
    }
  });

  it("never skips the single-flight index, even for a unique violation", async () => {
    const index = (await statementsOfARun()).find((sql) =>
      sql.includes("capture_jobs_active_key_idx ON"),
    );

    await expect(
      runMigrations(failing(index ?? "", Object.assign(new Error("dup"), { code: "23505" }))),
    ).rejects.toThrow("dup");
  });

  it("builds the design-link index when the rows allow it and leaves it out when they repeat", async () => {
    const client = new PGlite();
    const run = runnerFor(client);
    await runMigrations(run);
    await client.exec(`
      DROP INDEX design_links_project_import_path_idx;
      INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', now(), now());
      INSERT INTO design_links (id, project_id, import_path, url, created_at, updated_at)
        VALUES ('d1', 'p', './A.tsx', 'u1', now(), now()), ('d2', 'p', './A.tsx', 'u2', now(), now());
    `);

    await expect(runMigrations(run)).resolves.toBeUndefined();

    const indexes = await client.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'design_links'",
    );
    expect(indexes.rows.map((row) => row.indexname)).not.toContain(
      "design_links_project_import_path_idx",
    );
    await client.close();
  }, 60_000);
});
