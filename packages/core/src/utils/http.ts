import type { Logger } from "../logger.ts";

/**
 * Fetch JSON with timeout, retries, and structured errors.
 *
 * Retries network failures, 429, and 502/503/504 (honoring `Retry-After`);
 * every other status throws {@link HttpError} immediately.
 *
 * @param url - Absolute request URL.
 * @param options - Method, headers, JSON body, timeout, retries, logger.
 * @returns The parsed JSON response body.
 */
export async function httpJson<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
  return await requestWithRetry<T>(
    url,
    options,
    options.retries ?? DEFAULT_RETRIES,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
}

/** Failed HTTP response: status code plus a snippet of the response body. */
export class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly headers: Headers;

  constructor(status: number, body: string, headers?: Headers) {
    super(`HTTP ${status}: ${body}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
    this.headers = headers ?? new Headers();
  }
}

/** Options for {@link httpJson}. */
export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Body serialized as JSON with a `content-type` header. */
  json?: unknown;
  /** Per-attempt timeout in milliseconds (default 30s). */
  timeoutMs?: number;
  /** Total attempts including the first (default 3). */
  retries?: number;
  logger?: Logger;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 30_000;
const BACKOFF_BASE_MS = 1000;
const MAX_BODY_SNIPPET = 500;

/** Whether a failure is worth retrying: network errors, 429, and 502/503/504. */
function shouldRetry(error: unknown, attempt: number, maxAttempts: number): boolean {
  if (attempt >= maxAttempts) {
    return false;
  }
  if (!(error instanceof HttpError)) {
    return true;
  }
  return error.status === 429 || (error.status >= 502 && error.status <= 504);
}

/** Parse a Retry-After value (seconds or HTTP-date) into milliseconds. */
function parseRetryAfter(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_AFTER_MS);
  }
  return null;
}

/** Delay before the next attempt: Retry-After when present, else 1s/2s/4s. */
function retryDelayMs(error: unknown, attempt: number): number {
  if (error instanceof HttpError) {
    const retryAfter = parseRetryAfter(error.headers.get("retry-after"));
    if (retryAfter !== null) {
      return retryAfter;
    }
  }
  return Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), MAX_RETRY_AFTER_MS);
}

/** Sleep helper for retry backoff. */
async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/* oxlint-disable eslint/no-await-in-loop -- retry attempts run sequentially by design */
async function requestWithRetry<T>(
  url: string,
  options: HttpRequestOptions,
  maxAttempts: number,
  timeoutMs: number,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await doFetch<T>(url, options, timeoutMs);
    } catch (error) {
      if (!shouldRetry(error, attempt, maxAttempts)) {
        throw error;
      }
      await backoff(error, attempt, url, options.logger);
    }
  }
}
/* oxlint-enable eslint/no-await-in-loop */

async function backoff(
  error: unknown,
  attempt: number,
  url: string,
  logger?: Logger,
): Promise<void> {
  const delay = retryDelayMs(error, attempt);
  logger?.warn({ url, attempt, delayMs: delay }, "http request failed, retrying");
  await sleep(delay);
}

function buildRequest(options: HttpRequestOptions): {
  headers: Record<string, string>;
  body: string | undefined;
  method: string;
} {
  const headers: Record<string, string> = { ...options.headers };
  let body: string | undefined;
  if (options.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  return { headers, body, method: options.method ?? "GET" };
}

async function doFetch<T>(url: string, options: HttpRequestOptions, timeoutMs: number): Promise<T> {
  const request = buildRequest(options);
  options.logger?.debug({ url, method: request.method }, "http request");
  const response = await fetch(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new HttpError(response.status, text.slice(0, MAX_BODY_SNIPPET), response.headers);
  }
  return (await response.json()) as T;
}
