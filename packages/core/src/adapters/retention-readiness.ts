/**
 * The read-only retention check a one-shot `tool` command runs (ADR 0039): may the fenced
 * `buildReferenceLifecycle` be exposed on a database that this process did not migrate? The answer
 * comes from reads alone. It never migrates, never writes `schema_meta` and never prepares the
 * baseline pins: the server (or `migrate`) did that once for this release, and every later write
 * goes through the fenced lifecycle. Pure SQL shared by the three dialects.
 */
import { normalizeRelease, type SchemaLevelStore } from "./schema-level.ts";

const FIX = "Run `storyshelf-server serve` or `storyshelf-server migrate` once, then try again.";

/** A tool command cannot use build retention yet; the message is one plain line naming the fix. */
export class RetentionNotReadyError extends Error {
  constructor(reason: string) {
    super(`${reason} ${FIX}`);
    this.name = "RetentionNotReadyError";
  }
}

/** What a read-only activation is told about the running release. */
export interface ReadOnlyRetentionContext {
  /** The running release (`major.minor.patch`); absent or `0.0.0` cannot be compared. */
  readonly release?: string | undefined;
}

/** Runs one `SELECT`; rows come back as arrays or objects, read by column order. */
export type RetentionRowQuery = (sql: string) => Promise<readonly unknown[]>;

interface Level {
  major: number;
  minor: number;
}

function levelOf(version: string | null): Level | null {
  const match = /^(?<major>\d+)\.(?<minor>\d+)\./u.exec(normalizeRelease(version) ?? "");
  const { major, minor } = match?.groups ?? {};
  return major === undefined || minor === undefined
    ? null
    : { major: Number(major), minor: Number(minor) };
}

/**
 * Whether a database last migrated by `recorded` runs on release `own` as it is: the same minor, or
 * one minor newer (ADR 0053 decision 1, the case where boot skips its migrations). An older record
 * still needs this release's migration and preparation; a source run (`0.0.0`) has no level.
 */
export function schemaServesRelease(own: string | undefined, recorded: string | null): boolean {
  const ours = levelOf(own ?? null);
  const theirs = levelOf(recorded);
  if (ours === null || theirs === null || normalizeRelease(own) === "0.0.0") return false;
  return theirs.major === ours.major && [0, 1].includes(theirs.minor - ours.minor);
}

const INVALID_SOURCES = `SELECT b.id, b.source_build_id,
  CASE WHEN s.project_id <> b.project_id THEN 'other-project' ELSE 'tombstoned' END
FROM baselines b JOIN builds s ON s.id = b.source_build_id
WHERE s.project_id <> b.project_id OR s.retention_state <> 'available'
ORDER BY b.id`;

const UNPINNED_SOURCES = `SELECT b.id
FROM baselines b JOIN builds s ON s.id = b.source_build_id AND s.project_id = b.project_id
WHERE s.retention_state = 'available' AND NOT EXISTS (
  SELECT 1 FROM build_references r WHERE r.project_id = b.project_id
    AND r.owner_type = 'baseline' AND r.owner_id = b.id AND r.build_id = b.source_build_id)
ORDER BY b.id`;

function cells(row: unknown): unknown[] {
  if (Array.isArray(row)) return row;
  return row !== null && typeof row === "object" ? Object.values(row) : [row];
}

/**
 * Throw {@link RetentionNotReadyError} unless the schema serves this release and the baseline pins
 * are in the state boot preparation leaves them in: no recorded source is tombstoned or foreign
 * (the pause case) and every recorded, available source has its pin. Reads only.
 */
export async function assertRetentionReady(input: {
  release: string | undefined;
  store: SchemaLevelStore;
  query: RetentionRowQuery;
}): Promise<void> {
  if (!schemaServesRelease(input.release, await input.store.read())) {
    throw new RetentionNotReadyError(
      "Build retention is not prepared: the database was not migrated by this release.",
    );
  }
  const [invalid] = await input.query(INVALID_SOURCES);
  if (invalid !== undefined) {
    const [baseline, build, problem] = cells(invalid).map(String);
    throw new RetentionNotReadyError(
      `Build retention is paused: baseline ${baseline} has an invalid source build ${build} (${problem}); fix the data first.`,
    );
  }
  if ((await input.query(UNPINNED_SOURCES)).length > 0) {
    throw new RetentionNotReadyError(
      "Build retention is not prepared: some baselines have no pinned source build.",
    );
  }
}
