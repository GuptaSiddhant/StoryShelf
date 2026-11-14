import { describe, expect, it, vi } from "vitest";
import { DDL } from "./ddl.ts";
import { FOREIGN_KEYS } from "./foreign-keys.ts";
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

describe("runMigrations: an existing run_a11y", () => {
  it("is left alone when the column is already there, so a stored false survives", async () => {
    const queries: string[] = [];
    await runMigrations(async (sql) => {
      queries.push(sql);
      if (sql.includes("column_name = 'user_id'") && sql.includes("is_nullable")) {
        return [{ is_nullable: "NO" }];
      }
      // Every column the upgrade looks for already exists.
      return sql.includes("information_schema.columns") && sql.includes("LIMIT 1") ? [{}] : [];
    });
    const touching = queries.filter(
      (sql) => sql.includes("run_a11y") || sql.includes("a11y_violations"),
    );
    expect(touching.filter((sql) => /^(ALTER|UPDATE)/u.test(sql))).toEqual([]);
  });
});

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
    expect(
      queries.some(
        (sql) =>
          sql.includes("CONSTRAINT fk_builds_project_id") &&
          sql.includes("FOREIGN KEY (project_id) REFERENCES projects(id)"),
      ),
    ).toBe(true);
    expect(queries.some((sql) => sql.includes("REFERENCES") && !sql.includes("CONSTRAINT"))).toBe(
      false,
    );
    expect(queries).toContain(
      "ALTER TABLE `builds` ADD CONSTRAINT fk_builds_project_id FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE",
    );
  });

  it("keeps DDL constraints and migrations in sync", () => {
    const ddlKeys = [
      ...DDL.matchAll(
        /CONSTRAINT (?<name>\w+) FOREIGN KEY \((?<column>\w+)\) REFERENCES `?(?<parent>\w+)`?\((?<parentColumn>\w+)\)/gu,
      ),
    ].map((match) => {
      const groups = match.groups ?? {};
      return `${groups["name"]}:${groups["column"]}:${groups["parent"]}.${groups["parentColumn"]}`;
    });
    const migrationKeys = FOREIGN_KEYS.map(
      (foreignKey) =>
        `${foreignKey.name}:${foreignKey.column}:${foreignKey.parent}.${foreignKey.parentColumn}`,
    );
    expect(ddlKeys.toSorted()).toEqual(migrationKeys.toSorted());
  });

  it("skips foreign keys that already exist", async () => {
    const queries: string[] = [];
    const run = async (sql: string) => {
      queries.push(sql);
      return sql.includes("key_column_usage") ? [{ "1": 1 }] : [];
    };
    await runMigrations(run);
    expect(queries.some((sql) => sql.includes("ADD CONSTRAINT"))).toBe(false);
  });

  it("keeps a non-unique builds_project_gitsha_idx", async () => {
    const queries: string[] = [];
    const run = async (sql: string) => {
      queries.push(sql);
      if (sql.includes("NON_UNIQUE")) {
        return [{ non_unique: 1 }];
      }
      return sql.includes("index_name = 'builds_project_gitsha_idx'") ? [{ "1": 1 }] : [];
    };
    await runMigrations(run);
    expect(queries.some((sql) => sql.includes("DROP INDEX builds_project_gitsha_idx"))).toBe(false);
  });

  it("adds later columns and makes comment.user_id nullable with MODIFY", async () => {
    const { queries, run } = recordingRunner();
    await runMigrations(run);

    expect(queries).toContain(
      "ALTER TABLE projects ADD COLUMN review_enabled TINYINT(1) NOT NULL DEFAULT 1",
    );
    expect(queries).toContain("ALTER TABLE projects ADD COLUMN storybook_url_ttl_seconds INT");
    expect(queries).toContain("ALTER TABLE builds ADD COLUMN review_cycle INT NOT NULL DEFAULT 0");
    expect(queries).toContain("ALTER TABLE builds ADD COLUMN review_requested_cycle INT NULL");
    expect(queries).toContain(
      "ALTER TABLE notification_subscriptions ADD COLUMN review_requests BOOLEAN NOT NULL DEFAULT TRUE",
    );
    expect(queries).toContain("ALTER TABLE snapshots ADD COLUMN a11y_violations TEXT");
    expect(queries).toContain("ALTER TABLE comments ADD COLUMN story_id TEXT");
    expect(queries).toContain("ALTER TABLE comments ADD COLUMN mentions TEXT");
    expect(queries).toContain(
      "ALTER TABLE comments ADD COLUMN kind VARCHAR(32) NOT NULL DEFAULT 'comment'",
    );
    expect(queries).toContain("ALTER TABLE comments ADD COLUMN resolved_at DATETIME(3) NULL");
    expect(queries).toContain("ALTER TABLE comments ADD COLUMN resolved_by VARCHAR(64) NULL");
    expect(queries).toContain(
      "ALTER TABLE notification_channels ADD COLUMN last_error_at DATETIME(3)",
    );
    expect(queries).toContain(
      "ALTER TABLE notification_channels ADD COLUMN last_delivered_at DATETIME(3)",
    );
    expect(queries).toContain("ALTER TABLE comments MODIFY COLUMN user_id VARCHAR(64) NULL");
  });

  it("adds builds.capture_job_id, then backfills the run each in-flight build owns", async () => {
    const { queries, run } = recordingRunner();
    await runMigrations(run);

    const added = queries.indexOf("ALTER TABLE builds ADD COLUMN capture_job_id VARCHAR(26) NULL");
    const backfill = queries.findIndex((sql) => sql.startsWith("UPDATE builds SET capture_job_id"));
    expect(added).toBeGreaterThanOrEqual(0);
    expect(backfill).toBeGreaterThan(added);
    expect(queries[backfill]).toContain("j.status IN ('queued', 'running')");
    expect(queries[backfill]).toContain(
      "WHERE capture_job_id IS NULL AND status IN ('pending', 'capturing')",
    );
  });
});

describe("runMigrations: builds.capture_generation", () => {
  it("adds the run generation as a NOT NULL column defaulting to 0", async () => {
    const { queries, run } = recordingRunner();
    await runMigrations(run);

    expect(queries).toContain(
      "ALTER TABLE builds ADD COLUMN capture_generation INTEGER NOT NULL DEFAULT 0",
    );
  });
});

/** The `users` table block of the DDL. */
function usersDdl(): string {
  const start = DDL.indexOf("CREATE TABLE IF NOT EXISTS users (");
  return DDL.slice(start, DDL.indexOf("\n);", start));
}

describe("runMigrations: users auth columns", () => {
  const AUTH_COLUMNS = ["password_hash", "display_name_override", "auth_provider", "disabled"];

  it("adds the four auth columns to an existing users table", async () => {
    const { queries, run } = recordingRunner();
    await runMigrations(run);

    const added = queries.filter((sql) => sql.startsWith("ALTER TABLE users ADD COLUMN "));
    expect(added.map((sql) => sql.split(" ")[5])).toEqual(AUTH_COLUMNS);
    expect(queries).toContain(
      "ALTER TABLE users ADD COLUMN auth_provider VARCHAR(32) NOT NULL DEFAULT 'oidc'",
    );
    expect(queries).toContain(
      "ALTER TABLE users ADD COLUMN disabled TINYINT(1) NOT NULL DEFAULT 0",
    );
  });

  it("leaves a users table that already has them alone", async () => {
    const queries: string[] = [];
    await runMigrations(async (sql) => {
      queries.push(sql);
      if (sql.includes("information_schema.columns") && sql.includes("table_name = 'users'")) {
        return [{ 1: 1 }];
      }
      return sql.includes("column_name = 'user_id'") && sql.includes("is_nullable")
        ? [{ is_nullable: "NO" }]
        : [];
    });
    expect(queries.some((sql) => sql.startsWith("ALTER TABLE users ADD COLUMN "))).toBe(false);
  });

  it("adds only the auth columns that a partly upgraded table is still missing", async () => {
    const present = new Set(["password_hash", "display_name_override"]);
    const queries: string[] = [];
    const { run: base } = recordingRunner();
    await runMigrations(async (sql) => {
      queries.push(sql);
      const column = /table_name = 'users' AND column_name = '(?<column>\w+)'/u.exec(sql)?.groups?.[
        "column"
      ];
      if (column !== undefined) {
        return present.has(column) ? [{ 1: 1 }] : [];
      }
      return await base(sql);
    });
    const added = queries
      .filter((sql) => sql.startsWith("ALTER TABLE users ADD COLUMN "))
      .map((sql) => sql.split(" ")[5]);
    expect(added).toEqual(["auth_provider", "disabled"]);
  });

  it("fails the boot when the disabled column cannot be added", async () => {
    const { run: base } = recordingRunner();
    await expect(
      runMigrations(async (sql) => {
        if (sql.startsWith("ALTER TABLE users ADD COLUMN disabled")) {
          throw new Error("ALTER command denied to user for table 'users'");
        }
        return await base(sql);
      }),
    ).rejects.toThrow("ALTER command denied");
  });

  it("tolerates a concurrent boot that already added the column", async () => {
    const { run: base } = recordingRunner();
    await expect(
      runMigrations(async (sql) => {
        if (sql.startsWith("ALTER TABLE users ADD COLUMN disabled")) {
          throw Object.assign(new Error("Duplicate column name 'disabled'"), {
            code: "ER_DUP_FIELDNAME",
            errno: 1060,
          });
        }
        return await base(sql);
      }),
    ).resolves.toBeUndefined();
  });

  it("keeps the new-install DDL and the upgrade ALTER definitions identical", async () => {
    const { queries, run } = recordingRunner();
    await runMigrations(run);
    const ddl = usersDdl();
    for (const column of AUTH_COLUMNS) {
      const alter = queries.find((sql) =>
        sql.startsWith(`ALTER TABLE users ADD COLUMN ${column} `),
      );
      expect(alter, `ALTER for ${column}`).toBeDefined();
      const definition = (alter ?? "").slice(`ALTER TABLE users ADD COLUMN `.length);
      expect(ddl, `DDL for ${column}`).toContain(`  ${definition}`);
    }
  });
});

function captureJobsDdl(): string {
  const start = DDL.indexOf("CREATE TABLE IF NOT EXISTS capture_jobs (");
  return DDL.slice(start, DDL.indexOf("\n);", start));
}

describe("runMigrations: capture_jobs single-flight key", () => {
  const KEY_COLUMNS = ["active_key", "rerun_requested_at"];
  const KEY_INDEX = "CREATE UNIQUE INDEX capture_jobs_active_key_idx ON capture_jobs (active_key)";

  it("adds the key columns to an existing table, then its unique index", async () => {
    const { queries, run } = recordingRunner();
    await runMigrations(run);

    const added = queries.filter((sql) => sql.startsWith("ALTER TABLE capture_jobs ADD COLUMN "));
    expect(added.map((sql) => sql.split(" ")[5])).toEqual(KEY_COLUMNS);
    // The index is on a column an old table only gains from the ALTER, so it must come after it.
    expect(queries.filter((sql) => sql === KEY_INDEX)).toHaveLength(1);
    expect(queries.indexOf(KEY_INDEX)).toBeGreaterThan(queries.indexOf(added[0] ?? ""));
  });

  it("leaves a table that already has the columns and the index alone", async () => {
    const queries: string[] = [];
    await runMigrations(async (sql) => {
      queries.push(sql);
      const asksAboutJobs =
        sql.includes("table_name = 'capture_jobs'") &&
        (sql.includes("information_schema.columns") ||
          sql.includes("information_schema.statistics"));
      if (asksAboutJobs) {
        return [{ 1: 1 }];
      }
      return sql.includes("column_name = 'user_id'") && sql.includes("is_nullable")
        ? [{ is_nullable: "NO" }]
        : [];
    });
    expect(queries.some((sql) => sql.startsWith("ALTER TABLE capture_jobs ADD COLUMN "))).toBe(
      false,
    );
    expect(queries).not.toContain(KEY_INDEX);
  });

  it("keeps the new-install DDL and the upgrade ALTER definitions identical", async () => {
    const { queries, run } = recordingRunner();
    await runMigrations(run);
    const ddl = captureJobsDdl();
    for (const column of KEY_COLUMNS) {
      const alter = queries.find((sql) =>
        sql.startsWith(`ALTER TABLE capture_jobs ADD COLUMN ${column} `),
      );
      expect(alter, `ALTER for ${column}`).toBeDefined();
      const definition = (alter ?? "").slice("ALTER TABLE capture_jobs ADD COLUMN ".length);
      expect(ddl, `DDL for ${column}`).toContain(`  ${definition}`);
    }
  });
});

/** A runner that fails the first statement starting with `prefix` (in DDL order), once. */
function failingWith(prefix: string, error: Error): (sql: string) => Promise<unknown[]> {
  const { run } = recordingRunner();
  let failed = false;
  return async (sql) => {
    if (!failed && sql.startsWith(prefix)) {
      failed = true;
      throw error;
    }
    return await run(sql);
  };
}

describe("runMigrations: only an already-exists error is ignored", () => {
  it("tolerates a duplicate index name from a repeated DDL statement", async () => {
    const duplicate = Object.assign(new Error("Duplicate key name"), {
      code: "ER_DUP_KEYNAME",
      errno: 1061,
    });

    await expect(runMigrations(failingWith("CREATE INDEX", duplicate))).resolves.toBeUndefined();
  });

  it("fails the boot on any other DDL error, such as a lock timeout", async () => {
    const timeout = Object.assign(new Error("Lock wait timeout exceeded"), {
      code: "ER_LOCK_WAIT_TIMEOUT",
      errno: 1205,
    });

    await expect(runMigrations(failingWith("CREATE INDEX", timeout))).rejects.toThrow(
      "Lock wait timeout",
    );
  });

  it("fails the boot on an error that is not a duplicate column when adding a column", async () => {
    const denied = Object.assign(new Error("ALTER command denied"), {
      code: "ER_TABLEACCESS_DENIED_ERROR",
      errno: 1142,
    });

    await expect(
      runMigrations(failingWith("ALTER TABLE projects ADD COLUMN", denied)),
    ).rejects.toThrow("ALTER command denied");
  });
});

/** A runner whose group-count query answers with `groups`. */
function countingRunner(
  failOn: string,
  error: Error,
  groups: number,
): (sql: string) => Promise<unknown[]> {
  const { run } = recordingRunner();
  return async (sql) => {
    if (sql.startsWith(failOn)) throw error;
    if (sql.includes("AS duplicate_groups")) return [{ duplicate_groups: String(groups) }];
    return await run(sql);
  };
}

describe("runMigrations: a unique index over rows that already repeat its key", () => {
  const dupEntry = Object.assign(new Error("Duplicate entry 'secret' for key"), {
    code: "ER_DUP_ENTRY",
    errno: 1062,
  });

  it("boots without the design-link index and says so once, never with a row", async () => {
    const error = vi.fn();
    const run = countingRunner("CREATE UNIQUE INDEX design_links", dupEntry, 2);

    await expect(runMigrations(run, { error } as never)).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledOnce();
    const [fields, message] = error.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields).toEqual({
      table: "design_links",
      index: "design_links_project_import_path_idx",
      duplicateGroups: 2,
    });
    expect(message).toContain("created on the next boot");
    expect(message).not.toContain("secret");
  });

  it("still fails the boot on any other error creating that index", async () => {
    const timeout = Object.assign(new Error("Lock wait timeout exceeded"), {
      code: "ER_LOCK_WAIT_TIMEOUT",
      errno: 1205,
    });

    await expect(
      runMigrations(countingRunner("CREATE UNIQUE INDEX design_links", timeout, 0)),
    ).rejects.toThrow("Lock wait timeout");
  });

  it("never skips the single-flight index on duplicate keys", async () => {
    await expect(
      runMigrations(countingRunner("CREATE UNIQUE INDEX capture_jobs_active_key_idx", dupEntry, 1)),
    ).rejects.toThrow("Duplicate entry");
  });
});

describe("runMigrations: default-branch verification (#910)", () => {
  it("adds the project switch on for existing projects, and the build's answer column", async () => {
    const { queries, run } = recordingRunner();
    await runMigrations(run);

    expect(queries).toContain(
      "ALTER TABLE projects ADD COLUMN require_verified_default TINYINT(1) NOT NULL DEFAULT 1",
    );
    expect(queries).toContain("ALTER TABLE builds ADD COLUMN branch_verified VARCHAR(16) NULL");
  });
});
