import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import Database from "better-sqlite3";
import { sql as sqlTag } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBetterSqlite3Database } from "./better-sqlite3.ts";
import { createSqliteDatabase } from "./index.ts";

type BetterSqliteClient = InstanceType<typeof Database>;

const silentLogger = createShelfLogger({ level: "silent" });
const NOW = "2026-01-01T00:00:00.000Z";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storyshelf-legacy-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function boot(db: DatabaseAdapter): Promise<void> {
  await db.lifecycle?.setup({ config: {}, logger: silentLogger });
}

/** A `comments` table as it was before anonymous comments: `user_id` NOT NULL and 10 columns. */
const LEGACY_COMMENTS = `
  DROP TABLE comments;
  CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
    snapshot_id TEXT REFERENCES snapshots(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    parent_id TEXT,
    resolved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO comments (id, project_id, build_id, user_id, body, created_at, updated_at)
    VALUES ('c1', 'p', 'b', 'u', 'kept', '${NOW}', '${NOW}');
`;

interface Driver {
  name: string;
  open(path: string): DatabaseAdapter;
  /** Run SQL on a second connection to the same file, foreign keys off. */
  raw(path: string, sql: string): void;
  /** `[name, notnull]` per column of a table. */
  columns(path: string, table: string): [string, number][];
  /** The ids of a table's rows. */
  ids(path: string, table: string): string[];
}

const nodeSqlite: Driver = {
  name: "node:sqlite",
  open: (path) => createSqliteDatabase(path),
  raw: (path, sql) => {
    const connection = new DatabaseSync(path);
    connection.exec(`PRAGMA foreign_keys = OFF; ${sql}`);
    connection.close();
  },
  columns: (path, table) => {
    const connection = new DatabaseSync(path, { returnArrays: true });
    const rows = connection.prepare(`PRAGMA table_info(${table})`).all() as unknown as unknown[][];
    connection.close();
    return rows.map((row) => [String(row[1]), Number(row[3])]);
  },
  ids: (path, table) => {
    const connection = new DatabaseSync(path, { returnArrays: true });
    const rows = connection.prepare(`SELECT id FROM ${table}`).all() as unknown as unknown[][];
    connection.close();
    return rows.map((row) => String(row[0]));
  },
};

const betterSqlite3: Driver = {
  name: "better-sqlite3",
  open: (path) => createBetterSqlite3Database({ path }),
  raw: (path, sql) => {
    const connection = new Database(path);
    connection.exec(`PRAGMA foreign_keys = OFF; ${sql}`);
    connection.close();
  },
  columns: (path, table) => {
    const connection = new Database(path);
    const rows = connection.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
      notnull: number;
    }[];
    connection.close();
    return rows.map((row) => [row.name, row.notnull]);
  },
  ids: (path, table) => {
    const connection = new Database(path);
    const rows = connection.prepare(`SELECT id FROM ${table}`).all() as { id: string }[];
    connection.close();
    return rows.map((row) => row.id);
  },
};

describe.each([nodeSqlite, betterSqlite3])("upgrading an old volume on $name", (driver) => {
  async function volume(): Promise<string> {
    const path = join(dir, "test.sqlite");
    const db = driver.open(path);
    await boot(db);
    await db.lifecycle?.teardown();
    return path;
  }

  it("boots without the design-link index when rows repeat its key, says so once, and builds it on a later boot", async () => {
    const path = await volume();
    driver.raw(
      path,
      `DROP INDEX design_links_project_import_path_idx;
       INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', '${NOW}', '${NOW}');
       INSERT INTO design_links (id, project_id, import_path, url, created_at, updated_at)
         VALUES ('d1', 'p', './A.tsx', 'secret-u1', '${NOW}', '${NOW}'), ('d2', 'p', './A.tsx', 'secret-u2', '${NOW}', '${NOW}');`,
    );
    const error = vi.fn();
    const spy = { error } as unknown as typeof silentLogger;

    const first = driver.open(path);
    await first.lifecycle?.setup({ config: {}, logger: spy });
    await first.lifecycle?.teardown();

    expect(error).toHaveBeenCalledOnce();
    const [fields, message] = error.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields).toEqual({
      table: "design_links",
      index: "design_links_project_import_path_idx",
      duplicateGroups: 1,
    });
    expect(message).toContain("created on the next boot");
    // Never a row's contents.
    expect(message).not.toContain("secret");
    expect(JSON.stringify(fields)).not.toContain("secret");

    // Clean the data: the next boot creates the index, and says nothing.
    driver.raw(path, "DELETE FROM design_links WHERE id = 'd2'");
    error.mockClear();
    const second = driver.open(path);
    await second.lifecycle?.setup({ config: {}, logger: spy });
    await second.lifecycle?.teardown();
    expect(error).not.toHaveBeenCalled();
    expect(() =>
      driver.raw(
        path,
        `INSERT INTO design_links (id, project_id, import_path, url, created_at, updated_at)
         VALUES ('d3', 'p', './A.tsx', 'u3', '${NOW}', '${NOW}')`,
      ),
    ).toThrow(/UNIQUE constraint failed/u);
  });

  it("rebuilds a comments table that still requires a user, keeping its rows and every column", async () => {
    const path = await volume();
    driver.raw(
      path,
      `INSERT INTO users (id, name, email, created_at) VALUES ('u', 'U', 'u@x', '${NOW}');
       INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', '${NOW}', '${NOW}');
       INSERT INTO builds (id, project_id, git_sha, git_branch, status, created_at, updated_at) VALUES ('b', 'p', 's', 'main', 'pending', '${NOW}', '${NOW}');
       ${LEGACY_COMMENTS}`,
    );

    const db = driver.open(path);
    await boot(db);
    await db.lifecycle?.teardown();

    const columns = driver.columns(path, "comments");
    expect(driver.ids(path, "comments")).toEqual(["c1"]);
    expect(columns.find(([name]) => name === "user_id")?.[1]).toBe(0);
    expect(columns.map(([name]) => name)).toEqual(
      expect.arrayContaining(["story_id", "mentions", "kind", "resolved_at", "resolved_by"]),
    );
    driver.raw(
      path,
      `INSERT INTO comments (id, project_id, build_id, user_id, body, created_at, updated_at)
         VALUES ('c2', 'p', 'b', NULL, 'anonymous', '${NOW}', '${NOW}');`,
    );
  });

  it("rebuilds past a comments_new an earlier failed run left behind", async () => {
    const path = await volume();
    driver.raw(
      path,
      `INSERT INTO users (id, name, email, created_at) VALUES ('u', 'U', 'u@x', '${NOW}');
       INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', '${NOW}', '${NOW}');
       INSERT INTO builds (id, project_id, git_sha, git_branch, status, created_at, updated_at) VALUES ('b', 'p', 's', 'main', 'pending', '${NOW}', '${NOW}');
       ${LEGACY_COMMENTS}
       CREATE TABLE comments_new (id TEXT PRIMARY KEY);`,
    );

    const db = driver.open(path);
    await boot(db);
    await db.lifecycle?.teardown();

    expect(driver.ids(path, "comments")).toEqual(["c1"]);
    expect(driver.columns(path, "comments_new")).toEqual([]);
  });

  it("boots a second time without touching the rebuilt table", async () => {
    const path = await volume();
    driver.raw(path, LEGACY_COMMENTS.replace(/INSERT[\s\S]*$/u, ""));
    await boot(driver.open(path));

    await expect(boot(driver.open(path))).resolves.toBeUndefined();
  });
});

/** A better-sqlite3 client whose `exec` fails the statements `matches` picks, with `error`. */
function failing(
  client: BetterSqliteClient,
  matches: (sql: string) => boolean,
  error: Error,
): BetterSqliteClient {
  return new Proxy(client, {
    get(target, property) {
      if (property === "exec") {
        return (sql: string) => {
          if (matches(sql)) throw error;
          return target.exec(sql);
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function migrated(): Promise<string> {
  const path = join(dir, "test.sqlite");
  const db = createBetterSqlite3Database({ path });
  await boot(db);
  await db.lifecycle?.teardown();
  return path;
}

const bootWith = async (path: string, matches: (sql: string) => boolean, error: Error) => {
  const client = failing(new Database(path), matches, error);
  const db = createBetterSqlite3Database({ client });
  try {
    await boot(db);
  } finally {
    client.close();
  }
};

const adding = (sql: string) => sql.startsWith("ALTER TABLE snapshots ADD COLUMN duration_ms");
const dropping = (sql: string) => sql.startsWith("ALTER TABLE webhooks DROP COLUMN");

describe("a statement that fails stops the boot (better-sqlite3)", () => {
  const locked = new Error("database is locked");

  it("fails on a column that cannot be added, and carries on when another boot added it first", async () => {
    const path = await migrated();
    betterSqlite3.raw(path, "ALTER TABLE snapshots DROP COLUMN duration_ms");

    await expect(bootWith(path, adding, locked)).rejects.toThrow("database is locked");
    await expect(
      bootWith(path, adding, new Error("duplicate column name: duration_ms")),
    ).resolves.toBeUndefined();
  });

  it("fails on the webhook column drop unless the column is already gone", async () => {
    const path = await migrated();

    await expect(bootWith(path, dropping, locked)).rejects.toThrow("database is locked");
    await expect(
      bootWith(path, dropping, new Error('no such column: "secret"')),
    ).resolves.toBeUndefined();
  });

  it("fails on an index statement that errors", async () => {
    const path = await migrated();

    await expect(
      bootWith(path, (sql) => sql.startsWith("DROP INDEX IF EXISTS"), locked),
    ).rejects.toThrow("database is locked");
  });

  it("builds the design-link index when it can, and leaves it out when rows repeat its key", async () => {
    const path = await migrated();
    betterSqlite3.raw(
      path,
      `DROP INDEX design_links_project_import_path_idx;
       INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', '${NOW}', '${NOW}');
       INSERT INTO design_links (id, project_id, import_path, url, created_at, updated_at)
         VALUES ('d1', 'p', './A.tsx', 'u1', '${NOW}', '${NOW}'), ('d2', 'p', './A.tsx', 'u2', '${NOW}', '${NOW}');`,
    );

    await expect(bootWith(path, () => false, locked)).resolves.toBeUndefined();

    const connection = new Database(path);
    const names = (
      connection.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    connection.close();
    expect(names).not.toContain("design_links_project_import_path_idx");
  });

  it("leaves the old comments table and its rows, and foreign keys on, when the rebuild fails", async () => {
    const path = await migrated();
    betterSqlite3.raw(
      path,
      `INSERT INTO users (id, name, email, created_at) VALUES ('u', 'U', 'u@x', '${NOW}');
       INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', '${NOW}', '${NOW}');
       INSERT INTO builds (id, project_id, git_sha, git_branch, status, created_at, updated_at) VALUES ('b', 'p', 's', 'main', 'pending', '${NOW}', '${NOW}');
       ${LEGACY_COMMENTS}`,
    );
    const client = failing(new Database(path), (query) => query === "DROP TABLE comments", locked);

    await expect(boot(createBetterSqlite3Database({ client }))).rejects.toThrow(
      "database is locked",
    );

    expect(client.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    client.close();
    expect(betterSqlite3.ids(path, "comments")).toEqual(["c1"]);
    expect(betterSqlite3.columns(path, "comments_new")).toEqual([]);
    expect(betterSqlite3.columns(path, "comments").find(([name]) => name === "user_id")?.[1]).toBe(
      1,
    );
  });

  it("does not skip any other failure of that unique index", async () => {
    const path = await migrated();
    betterSqlite3.raw(path, "DROP INDEX design_links_project_import_path_idx");

    await expect(
      bootWith(path, (sql) => sql.includes("design_links_project_import_path_idx"), locked),
    ).rejects.toThrow("database is locked");
  });
});

/** Make `DatabaseSync.exec` fail the statements `matches` picks, for every connection in the process. */
function failNodeSqlite(
  matches: (sql: string) => boolean,
  error: Error,
  beforeThrow?: (exec: (database: DatabaseSync, sql: string) => void) => void,
): void {
  const original = DatabaseSync.prototype.exec;
  vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    if (matches(sql)) {
      beforeThrow?.((database, statement) => {
        original.call(database, statement);
      });
      throw error;
    }
    return original.call(this, sql);
  });
}

async function migratedNodeSqlite(): Promise<string> {
  const path = join(dir, "test.sqlite");
  const db = createSqliteDatabase(path);
  await boot(db);
  await db.lifecycle?.teardown();
  return path;
}

describe("a statement that fails stops the boot (node:sqlite)", () => {
  const locked = new Error("database is locked");

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails on a column that cannot be added, and carries on when another boot added it first", async () => {
    const path = await migratedNodeSqlite();
    nodeSqlite.raw(path, "ALTER TABLE snapshots DROP COLUMN duration_ms");
    failNodeSqlite(adding, locked);
    await expect(boot(createSqliteDatabase(path))).rejects.toThrow("database is locked");
    vi.restoreAllMocks();

    // Another boot adds the column on its own connection just before ours fails with "duplicate".
    failNodeSqlite(adding, new Error("duplicate column name: duration_ms"), (exec) => {
      const other = new DatabaseSync(path);
      try {
        exec(other, "ALTER TABLE snapshots ADD COLUMN duration_ms INTEGER");
      } finally {
        other.close();
      }
    });
    await expect(boot(createSqliteDatabase(path))).resolves.toBeUndefined();
    expect(nodeSqlite.columns(path, "snapshots").map(([name]) => name)).toContain("duration_ms");
  });

  it("stops the boot when existing rows repeat a single-flight key", async () => {
    const path = await migratedNodeSqlite();
    nodeSqlite.raw(path, "DROP INDEX capture_jobs_active_key_idx");
    nodeSqlite.raw(
      path,
      `INSERT INTO capture_jobs (id, entry, job_id, kind, status, active_key, created_at, updated_at)
       VALUES ('j1', 'job', 'j1', 'capture', 'queued', 'capture:b1', 't', 't'),
              ('j2', 'job', 'j2', 'capture', 'queued', 'capture:b1', 't', 't')`,
    );

    await expect(boot(createSqliteDatabase(path))).rejects.toThrow(/UNIQUE constraint failed/u);
  });

  it("fails on the webhook column drop unless the column is already gone", async () => {
    const path = await migratedNodeSqlite();
    failNodeSqlite(dropping, locked);
    await expect(boot(createSqliteDatabase(path))).rejects.toThrow("database is locked");
    vi.restoreAllMocks();

    failNodeSqlite(dropping, new Error('no such column: "secret"'));
    await expect(boot(createSqliteDatabase(path))).resolves.toBeUndefined();
  });

  it("fails on an error while replacing the git-sha index", async () => {
    const path = await migratedNodeSqlite();
    failNodeSqlite(
      (sql) => sql.startsWith("DROP INDEX IF EXISTS builds_project_gitsha_idx"),
      locked,
    );

    await expect(boot(createSqliteDatabase(path))).rejects.toThrow("database is locked");
  });

  it("leaves the old comments table and its rows, and foreign keys on, when the rebuild fails", async () => {
    const path = await migratedNodeSqlite();
    nodeSqlite.raw(
      path,
      `INSERT INTO users (id, name, email, created_at) VALUES ('u', 'U', 'u@x', '${NOW}');
       INSERT INTO projects (id, name, slug, created_at, updated_at) VALUES ('p', 'P', 'p', '${NOW}', '${NOW}');
       INSERT INTO builds (id, project_id, git_sha, git_branch, status, created_at, updated_at) VALUES ('b', 'p', 's', 'main', 'pending', '${NOW}', '${NOW}');
       ${LEGACY_COMMENTS}`,
    );
    failNodeSqlite((sql) => sql === "DROP TABLE comments", locked);
    const db = createSqliteDatabase(path);

    await expect(boot(db)).rejects.toThrow("database is locked");

    vi.restoreAllMocks();
    expect(nodeSqlite.ids(path, "comments")).toEqual(["c1"]);
    expect(nodeSqlite.columns(path, "comments_new")).toEqual([]);
    expect(nodeSqlite.columns(path, "comments").find(([name]) => name === "user_id")?.[1]).toBe(1);
    const flag = await db.all<unknown[]>(sqlTag`PRAGMA foreign_keys`);
    expect(flag).toEqual([[1]]);
    await db.lifecycle?.teardown();
  });
});
