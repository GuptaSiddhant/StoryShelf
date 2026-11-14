/**
 * Boot comparison of the running release with the one that last migrated the database
 * (ADR 0053, decision 2). Pure decision plus one orchestrator every db driver calls, so the three
 * dialects share one rule. Patch versions compare as their minor.
 */
import type { Logger } from "../logger.ts";

/** What boot does with the migrations. */
export type MigrationDecision = "migrate" | "skip" | "refuse";

interface Level {
  major: number;
  minor: number;
}

/** `major.minor` of a `x.y.z[-pre]` version, or `null` when it is not one. */
function parseLevel(version: string | null | undefined): Level | null {
  const match = /^(?<major>\d+)\.(?<minor>\d+)\.\d+(?:[-+].*)?$/u.exec(version ?? "");
  const groups = match?.groups;
  if (groups?.["major"] === undefined || groups["minor"] === undefined) return null;
  return { major: Number(groups["major"]), minor: Number(groups["minor"]) };
}

/** The `major.minor.patch` form that is stored, or `null` for a version that is not comparable. */
export function normalizeRelease(version: string | null | undefined): string | null {
  const match = /^(?<core>\d+\.\d+\.\d+)(?:[-+].*)?$/u.exec(version ?? "");
  return match?.groups?.["core"] ?? null;
}

/**
 * Compare `own` with the `recorded` release. No record, an unreadable record, or an `own` that is
 * not a release (source runs report `0.0.0`) is "older": migrate. A database one minor newer is
 * compatible by ADR 0053 decision 1: skip. Anything further ahead refuses.
 */
export function decideMigration(own: string, recorded: string | null): MigrationDecision {
  const ours = parseLevel(own);
  const theirs = parseLevel(recorded);
  if (ours === null || theirs === null || own === "0.0.0") return "migrate";
  if (theirs.major !== ours.major) return theirs.major > ours.major ? "refuse" : "migrate";
  const ahead = theirs.minor - ours.minor;
  if (ahead <= 0) return "migrate";
  return ahead === 1 ? "skip" : "refuse";
}

/** Boot refused: the database was migrated by a release more than one minor newer. */
export class SchemaTooNewError extends Error {
  readonly release: string;
  readonly databaseRelease: string;
  constructor(release: string, databaseRelease: string) {
    super(
      `Refusing to start: this is release ${release}, but the database was migrated by release ${databaseRelease}, more than one minor newer. Run release ${databaseRelease} or newer, or restore an older database.`,
    );
    this.name = "SchemaTooNewError";
    this.release = release;
    this.databaseRelease = databaseRelease;
  }
}

/** How a driver reads and writes the `schema_meta` row. */
export interface SchemaLevelStore {
  /** The recorded release; `null` when the table or the row is missing. Never creates anything. */
  read: () => Promise<string | null>;
  /** Upsert the row; the table exists once the migrations ran. */
  write: (release: string) => Promise<void>;
}

export interface GatedMigration {
  /** The running release (`MigrationContext.release`); absent means "not known": migrate. */
  release: string | undefined;
  store: SchemaLevelStore;
  /** The driver's own migrations. */
  migrate: () => Promise<void>;
  logger?: Logger | undefined;
}

/**
 * Migrate, skip or refuse as {@link decideMigration} says, then record the release after a
 * migration. A skip leaves the row alone: the newer release owns it.
 */
export async function gatedMigration(input: GatedMigration): Promise<MigrationDecision> {
  const own = normalizeRelease(input.release);
  const recorded = own === null ? null : await input.store.read();
  const decision = own === null ? "migrate" : decideMigration(own, recorded);
  if (decision === "refuse") throw new SchemaTooNewError(own ?? "", recorded ?? "");
  if (decision === "skip") {
    input.logger?.info(
      { release: own, databaseRelease: recorded },
      "database is one minor newer: skipping migrations",
    );
    return decision;
  }
  await input.migrate();
  if (own !== null && own !== "0.0.0") await input.store.write(own);
  return decision;
}

/** The SQL dialects that keep `schema_meta`. */
export type SchemaLevelDialect = "sqlite" | "postgres" | "mysql";

/** Runs one statement and returns its rows (arrays or objects: only the first value is read). */
export type SchemaLevelQuery = (sql: string) => Promise<unknown[]>;

const EXISTS_SQL: Record<SchemaLevelDialect, string> = {
  sqlite: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'",
  postgres: "SELECT to_regclass('schema_meta') AS found",
  mysql:
    "SELECT table_name AS found FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'schema_meta'",
};

const UPSERT_TAIL: Record<SchemaLevelDialect, string> = {
  sqlite:
    "ON CONFLICT (id) DO UPDATE SET version = excluded.version, migrated_at = excluded.migrated_at",
  postgres:
    "ON CONFLICT (id) DO UPDATE SET version = excluded.version, migrated_at = excluded.migrated_at",
  mysql: "ON DUPLICATE KEY UPDATE version = VALUES(version), migrated_at = VALUES(migrated_at)",
};

function firstValue(rows: unknown[]): unknown {
  const row = rows[0];
  if (Array.isArray(row)) return row[0];
  if (row !== null && typeof row === "object") return Object.values(row)[0];
  return row;
}

/** The `schema_meta` row through plain SQL, for every driver of a dialect. */
export function sqlSchemaLevelStore(
  run: SchemaLevelQuery,
  dialect: SchemaLevelDialect,
  now: () => Date = () => new Date(),
): SchemaLevelStore {
  return {
    read: async () => {
      const found = firstValue(await run(EXISTS_SQL[dialect]));
      if (found === undefined || found === null) return null;
      const value = firstValue(await run("SELECT version FROM schema_meta WHERE id = 'schema'"));
      return typeof value === "string" ? value : null;
    },
    write: async (version) => {
      const iso = now().toISOString();
      const at = dialect === "mysql" ? iso.replace("T", " ").replace("Z", "") : iso;
      await run(
        `INSERT INTO schema_meta (id, version, migrated_at) VALUES ('schema', '${normalizeRelease(version) ?? "0.0.0"}', '${at}') ${UPSERT_TAIL[dialect]}`,
      );
    },
  };
}
