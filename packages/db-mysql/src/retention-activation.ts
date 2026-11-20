/**
 * Switch on lifecycle-aware retention for MySQL (ADR 0039): once the schema is migrated, check that
 * the server is one the lifecycle was proven on, prepare the baseline pins, then expose
 * `buildReferenceLifecycle`. Anything else leaves the capability off, so retention stays fail closed:
 *
 * - a preset whose transport was never proven (PlanetScale, TiDB Serverless), an injected single
 *   connection (every party would share one session, so row locks prove nothing), or a server that
 *   is not MySQL 8 with InnoDB tables is refused with an actionable warning;
 * - a recorded baseline source the preparation must not touch is reported through `retentionPause`;
 *   fixing the data and restarting turns it on.
 */
import type {
  BuildReferenceLifecycle,
  DatabaseAdapter,
  RetentionPause,
} from "@storyshelf/core/adapter/database";
import { BaselineSourceIntegrityError } from "@storyshelf/core/adapter/database";
import type { Logger } from "@storyshelf/core/logger";
import { prepareBaselineReferences } from "./baseline-preparation.ts";
import { createBuildReferenceLifecycle } from "./build-reference-lifecycle.ts";
import { onConnection, statementsOn, type LifecyclePool } from "./lifecycle-transaction.ts";

/** What boot decided; read through getters, so the adapter reflects a later activation. */
export interface RetentionActivation {
  lifecycle?: BuildReferenceLifecycle;
  pause?: RetentionPause;
  logger?: Logger;
}

/** The tables the lifecycle locks; each must be transactional (InnoDB). */
const LIFECYCLE_TABLES = [
  "builds",
  "baselines",
  "build_references",
  "build_reference_generations",
  "build_deletions",
  "build_content_releases",
  "content_uses",
] as const;

/** Server variables {@link refusalOf} decides on, as `SELECT` reads them. */
export interface ServerFacts {
  version: string;
  comment: string;
  binlog: boolean;
  binlogFormat: string;
  engines: Readonly<Record<string, string>>;
}

const ADVICE =
  "Build retention stays off (no automatic build deletion or branch GC with testing). Use " +
  "createMysqlDatabase with a pool on MySQL 8 (InnoDB); see the MySQL deployment notes.";

/**
 * Why the lifecycle must not run on this server, or null when it may. Only MySQL 8 with InnoDB was
 * proven: MariaDB, TiDB and Vitess (PlanetScale) speak the protocol but lock differently; MyISAM
 * ignores transactions; statement-based binary logging refuses READ COMMITTED writes.
 */
export function refusalOf(facts: ServerFacts): string | null {
  const banner = `${facts.version} ${facts.comment}`;
  if (/mariadb|tidb|vitess/iu.test(banner)) return `${banner.trim()} is not MySQL`;
  const major = Number(/^(?<major>\d+)\./u.exec(facts.version)?.groups?.["major"]);
  if (major !== 8) return `MySQL ${facts.version} is not MySQL 8`;
  if (facts.binlog && facts.binlogFormat.toUpperCase() === "STATEMENT")
    return "binlog_format is STATEMENT; READ COMMITTED transactions need ROW or MIXED";
  const missing = LIFECYCLE_TABLES.filter((table) => facts.engines[table] === undefined);
  if (missing.length > 0) return `tables missing: ${missing.join(", ")}`;
  const other = LIFECYCLE_TABLES.filter(
    (table) => facts.engines[table]?.toUpperCase() !== "INNODB",
  );
  if (other.length > 0) return `tables not on InnoDB: ${other.join(", ")}`;
  return null;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Read the {@link ServerFacts} on one connection of the pool. */
export async function serverFacts(pool: LifecyclePool): Promise<ServerFacts> {
  return await onConnection(pool, async (connection) => {
    const { query } = statementsOn(connection);
    const [server] = await query(
      "SELECT VERSION() AS version, @@version_comment AS comment, @@log_bin AS binlog, @@binlog_format AS format",
    );
    const tables = await query(
      "SELECT table_name AS name, engine FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?)",
      [[...LIFECYCLE_TABLES]],
    );
    return {
      version: textOf(server?.["version"]),
      comment: textOf(server?.["comment"]),
      binlog: Number(server?.["binlog"]) === 1,
      binlogFormat: textOf(server?.["format"]),
      engines: Object.fromEntries(
        tables.map((row) => [
          String(row["name"] ?? row["NAME"]),
          String(row["engine"] ?? row["ENGINE"]),
        ]),
      ),
    };
  });
}

/** Where the adapter's connections come from, as far as retention is concerned. */
export type RetentionSource = { pool: LifecyclePool } | { refused: string };

/**
 * Check the server, prepare the baselines and expose the capability. A refusal is logged once at
 * warn level and leaves the capability off; any failure other than a
 * {@link BaselineSourceIntegrityError} propagates: the boot fails rather than guess.
 */
export async function activateRetention(
  source: RetentionSource,
  state: RetentionActivation,
  logger?: Logger,
): Promise<void> {
  delete state.lifecycle;
  delete state.pause;
  const log = state.logger ?? logger;
  const pool = await verifiedPool(source, log);
  if (pool === null) return;
  try {
    await prepareAndExpose(pool, state, log);
  } catch (error) {
    if (!(error instanceof BaselineSourceIntegrityError)) throw error;
    pauseRetention(state, error, log);
  }
}

/** The pool when the lifecycle may run on it; otherwise null, after saying why at warn level. */
async function verifiedPool(
  source: RetentionSource,
  log: Logger | undefined,
): Promise<LifecyclePool | null> {
  const refusal = "pool" in source ? refusalOf(await serverFacts(source.pool)) : source.refused;
  if (refusal === null && "pool" in source) return source.pool;
  log?.warn(
    { reason: refusal },
    `build retention is unavailable on this MySQL connection. ${ADVICE}`,
  );
  return null;
}

async function prepareAndExpose(
  pool: LifecyclePool,
  state: RetentionActivation,
  log: Logger | undefined,
): Promise<void> {
  const startedAt = performance.now();
  const prepared = await prepareBaselineReferences(pool);
  state.lifecycle = createBuildReferenceLifecycle(pool);
  log?.info(
    { ...prepared, ms: Math.round(performance.now() - startedAt) },
    "baseline references prepared; build retention is active",
  );
}

/** Keep the capability off and say why, once, so the System page and the log agree. */
function pauseRetention(
  state: RetentionActivation,
  error: BaselineSourceIntegrityError,
  log: Logger | undefined,
): void {
  const { baselineId, buildId, problem } = error;
  state.pause = { baselineId, buildId, problem };
  log?.error(
    { baselineId, buildId, problem },
    "retention is paused: a baseline has an invalid source build; fix the data and restart",
  );
}

/** Define the capability, the pause and `setLogger` on the adapter, reading `state` when asked. */
export function attachRetention(
  adapter: DatabaseAdapter,
  state: RetentionActivation,
): DatabaseAdapter {
  Object.defineProperties(adapter, {
    // Assignable, so a test can swap in a wrapped capability; production code only reads it.
    buildReferenceLifecycle: {
      enumerable: true,
      get: () => state.lifecycle,
      set: (value: BuildReferenceLifecycle | undefined) => {
        state.lifecycle = value;
      },
    },
    retentionPause: { enumerable: true, get: () => state.pause },
    setLogger: {
      enumerable: true,
      value: (logger: Logger): void => {
        state.logger = logger;
      },
    },
  });
  return adapter;
}
