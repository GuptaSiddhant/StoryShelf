/**
 * What the Postgres drivers share about a connection string: the scheme check, the credential-free
 * name of the target, the one failure line, and the sink that routes server notices to the logger.
 */
import type { Logger } from "@storyshelf/core/logger";

/** The setting the scaffold and the instance module read the connection string from. */
const SETTING = "DATABASE_URL";

/** Refuse a connection string that is not a `postgres://` or `postgresql://` URL, naming the setting. */
export function assertPostgresUrl(connectionString: string): void {
  if (!/^postgres(?:ql)?:\/\//u.test(connectionString)) {
    throw new Error(
      `${SETTING} must start with postgres:// or postgresql:// (for example postgres://user:password@host:5432/dbname)`,
    );
  }
}

/** `host:port/database` of a connection string, never the user or the password; `null` when it does not parse. */
export function describeTarget(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    const database = decodeURIComponent(url.pathname.replace(/^\//u, ""));
    return `${url.hostname || "localhost"}:${url.port || "5432"}${database ? `/${database}` : ""}`;
  } catch {
    return null;
  }
}

/** The driver's reason: an aggregate error (a host with several addresses) has no message of its own. */
function reasonOf(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return reasonOf(error.errors[0]);
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && !message.includes(code) ? `${code} ${message}` : message;
}

/**
 * The one line a failed database start ends with: the target and the driver's reason. The reason
 * never reaches this line with the connection string in it: a driver that echoes it is cut.
 */
export function connectFailure(connectionString: string | undefined, error: unknown): Error {
  const target = connectionString === undefined ? null : describeTarget(connectionString);
  let reason = reasonOf(error);
  if (connectionString !== undefined) {
    reason = reason.split(connectionString).join("[connection string]");
  }
  const failure = new Error(
    `cannot start the database${target === null ? "" : ` at ${target}`}: ${reason}`,
    { cause: error },
  );
  return failure;
}

/** Run `start`, turning its failure into {@link connectFailure}. */
export async function nameFailure(
  connectionString: string | undefined,
  start: () => Promise<void>,
): Promise<void> {
  try {
    await start();
  } catch (error) {
    throw connectFailure(connectionString, error);
  }
}

/** A server notice as drivers hand it over (postgres.js, `pg` and Neon all carry these fields). */
export interface PostgresNotice {
  severity?: string;
  code?: string;
  message?: string;
}

/**
 * Where a driver's `onnotice` goes: the adapter's logger at debug, once the setup hands it over.
 * Before that a notice is dropped, so nothing prints to the console by itself.
 */
export interface NoticeSink {
  attach(logger: Logger): void;
  notice(notice: PostgresNotice): void;
}

export function createNoticeSink(): NoticeSink {
  let logger: Logger | undefined;
  return {
    attach: (next) => {
      logger = next;
    },
    notice: (notice) => {
      logger?.debug(
        { severity: notice.severity, code: notice.code, notice: notice.message },
        "postgres notice",
      );
    },
  };
}

/** A pool that announces each new connection (`pg` and Neon pools both do); typed here, as `pg`'s ambient types stop short of events. */
interface NoticePool {
  on(event: "connect", listener: (client: NoticeClient) => void): unknown;
}

interface NoticeClient {
  on(event: "notice", listener: (notice: PostgresNotice) => void): unknown;
}

/** Send the `notice` events of every connection a pool opens to `sink`. */
export function routeNotices(pool: unknown, sink: NoticeSink): void {
  (pool as NoticePool).on("connect", (client) => {
    client.on("notice", (notice) => {
      sink.notice(notice);
    });
  });
}
