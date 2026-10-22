/** Retrying a connection to a remote browser service (ADR 0007, decision 4). */

/** Options of {@link retryConnect}. */
export interface RetryConnectOptions {
  /** Retries after the first attempt. */
  retries: number;
  /** Delay before the first retry in ms; doubles each time, with jitter, capped at 10 s. */
  backoffMs: number;
  /** Called before each retry with the error, the retry's number (from 1) and its delay. */
  onRetry?: (error: unknown, retry: number, delayMs: number) => void;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const MAX_DELAY_MS = 10_000;

/** Errors that no retry fixes: a refused credential, a missing endpoint, mismatched versions. */
const PERMANENT =
  /\b(?:401|403|404|428|unauthorized|forbidden|version mismatch|invalid (?:token|credentials)|not found)\b/iu;

/** Errors of the connection itself: refused, dropped, timed out, or a service with no free session. */
const CONNECTION =
  /(?:ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|socket hang up|websocket error|connection (?:closed|refused|reset)|timeout|timed out|capacity|too many|queue(?:d)? full|no (?:free )?(?:session|browser)|\b(?:408|425|429|500|502|503|504)\b)/iu;

/** Whether a connect error is worth retrying: connection-level, not a configuration mistake. */
export function isRetryableConnectError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return !PERMANENT.test(text) && CONNECTION.test(text);
}

/**
 * Run `connect`, retrying a connection-level failure with exponential backoff, so a provider
 * outage or a full plan is absorbed here and crash isolation only ever sees a browser that died
 * while rendering. The last error is thrown once the retries are spent.
 */
export async function retryConnect<T>(
  connect: () => Promise<T>,
  options: RetryConnectOptions,
): Promise<T> {
  const sleep = options.sleep ?? sleepFor;
  for (let retry = 0; ; retry += 1) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- attempts are sequential by design
      return await connect();
    } catch (error) {
      if (retry >= options.retries || !isRetryableConnectError(error)) {
        throw error;
      }
      const delayMs = Math.min(MAX_DELAY_MS, options.backoffMs * 2 ** retry) * jitter();
      options.onRetry?.(error, retry + 1, Math.round(delayMs));
      // oxlint-disable-next-line eslint/no-await-in-loop -- backoff between sequential attempts
      await sleep(delayMs);
    }
  }
}

/** 0.75 to 1.25: providers refusing for capacity should not see every shard retry in step. */
function jitter(): number {
  return 0.75 + Math.random() * 0.5;
}

async function sleepFor(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
