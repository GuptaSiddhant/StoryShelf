/**
 * Connection pragmas shared by the SQLite drivers.
 *
 * WAL is always on. `synchronous` decides how often the write-ahead log is
 * flushed to disk: `NORMAL` (the default) syncs only at checkpoints, so an
 * application crash loses nothing, while an OS crash or power loss can drop
 * the last committed transactions but never corrupts the database. `FULL`
 * syncs on every commit, for hosts that need those transactions to survive a
 * power cut.
 */
export type SqliteSynchronous = "normal" | "full";

export interface SqliteConnectionOptions {
  /** Durability of committed writes under WAL. Default `"normal"`. */
  synchronous?: SqliteSynchronous;
}

/** Run the connection pragmas on a driver's `exec`. */
export function applyConnectionPragmas(
  exec: (sql: string) => unknown,
  options: SqliteConnectionOptions = {},
): void {
  exec("PRAGMA journal_mode = WAL");
  exec(`PRAGMA synchronous = ${synchronousKeyword(options.synchronous)}`);
  exec("PRAGMA busy_timeout = 5000");
}

function synchronousKeyword(mode: SqliteSynchronous | undefined): "NORMAL" | "FULL" {
  return mode === "full" ? "FULL" : "NORMAL";
}
