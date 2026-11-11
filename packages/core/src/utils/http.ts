import type { Span } from "@opentelemetry/api";
import { Buffer } from "node:buffer";
import type { Logger } from "../logger.ts";
import { injectTraceContext, setSpanMessage, spanException, withSpan } from "../tracing.ts";
import { guardedFetch } from "./outbound-fetch.ts";
import { OutboundRefusedError } from "./outbound.ts";

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
    doFetchJson,
  );
}

/**
 * Download a binary response (images) with the same timeout, retry, and
 * `Retry-After` semantics as {@link httpJson}.
 *
 * @param url - Absolute request URL.
 * @param options - Method, headers, timeout, retries, logger.
 * @returns The raw response bytes.
 */
export async function httpBytes(url: string, options: HttpRequestOptions = {}): Promise<Buffer> {
  return await requestWithRetry<Buffer>(
    url,
    options,
    options.retries ?? DEFAULT_RETRIES,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    doFetchBytes,
  );
}

/**
 * POST/PUT plain payloads (e.g. Slack/Teams webhook cards) with the same
 * timeout, retry, and `Retry-After` semantics as {@link httpJson}.
 *
 * @param url - Absolute request URL.
 * @param options - Method, headers, text body, timeout, retries, logger.
 * @returns The raw response body text.
 */
export async function httpText(url: string, options: HttpTextOptions = {}): Promise<string> {
  return await requestWithRetry<string>(
    url,
    options,
    options.retries ?? DEFAULT_RETRIES,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    doFetchText,
  );
}

/**
 * Send a request and resolve with the response status, without ever reading the response body (it
 * is cancelled on every response). Use it when the answer is only "did it succeed", such as webhook
 * delivery, so a receiver cannot make the process buffer an arbitrarily large body. Retries,
 * timeouts, redaction and tracing are those of {@link httpText}. A non-2xx response throws
 * {@link HttpError} with an empty `body`.
 *
 * @param url - Absolute request URL.
 * @param options - Method, headers, JSON body, timeout, retries, logger.
 * @returns The 2xx response status.
 */
export async function httpStatus(url: string, options: HttpTextOptions = {}): Promise<number> {
  return await requestWithRetry<number>(
    url,
    options,
    options.retries ?? DEFAULT_RETRIES,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    doFetchStatus,
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
  /** Body serialized as `application/x-www-form-urlencoded` (ignored when `json` is set). */
  form?: Record<string, string>;
  /** Per-attempt timeout in milliseconds (default 30s). */
  timeoutMs?: number;
  /** Total attempts including the first (default 3). */
  retries?: number;
  /** Aborts the request (and any further retry) when it fires. */
  signal?: AbortSignal;
  /**
   * `"project"` marks a URL a project configured: it must be `https` and public (or on the operator
   * allowlist), is pinned to the checked address, and each redirect is checked again. Omit for
   * operator-configured URLs.
   */
  destination?: "project";
  logger?: Logger;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Options for {@link httpText}. */
export interface HttpTextOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Body serialized as JSON with a `content-type` header. */
  json?: unknown;
  /** Per-attempt timeout in milliseconds (default 30s). */
  timeoutMs?: number;
  /** Total attempts including the first (default 3). */
  retries?: number;
  /** Aborts the request (and any further retry) when it fires. */
  signal?: AbortSignal;
  /**
   * `"project"` marks a URL a project configured: it must be `https` and public (or on the operator
   * allowlist), is pinned to the checked address, and each redirect is checked again. Omit for
   * operator-configured URLs.
   */
  destination?: "project";
  logger?: Logger;
}
const DEFAULT_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 30_000;
const BACKOFF_BASE_MS = 1000;
const MAX_BODY_SNIPPET = 500;

/** Whether a failure is worth retrying: network errors, 429, and 502/503/504. */
function shouldRetry(error: unknown, attempt: number, maxAttempts: number): boolean {
  if (attempt >= maxAttempts) {
    return false;
  }
  if (error instanceof OutboundRefusedError) {
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
  perform: (url: string, options: HttpRequestOptions, timeoutMs: number) => Promise<T>,
): Promise<T> {
  return await withSpan(
    "http.client",
    async (span) => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await perform(url, options, timeoutMs);
        } catch (error) {
          describeFailure(span, error, url);
          if (options.signal?.aborted || !shouldRetry(error, attempt, maxAttempts)) {
            // The final failure is recorded once, by `withSpan`, in the same redacted form.
            throw error;
          }
          span.recordException(spanException(error));
          span.setAttribute("http.retry.count", attempt);
          await backoff(error, attempt, url, options.logger);
        }
      }
    },
    { "http.request.method": options.method ?? "GET", "url.full": redactUrlForLog(url) },
  );
}
/* oxlint-enable eslint/no-await-in-loop */

/**
 * The form of a request URL that may appear in logs and span attributes: its origin
 * (`protocol//host`) and nothing else. The path of an incoming webhook (Slack, Teams) is the secret,
 * a bot token can be the first segment (Telegram), and other URLs carry credentials in the userinfo
 * or the query, so the path, query, fragment and userinfo are dropped by construction. There is no
 * opt-out.
 */
export function redactUrlForLog(url: string): string {
  try {
    const { protocol, host } = new URL(url);
    return `${protocol}//${host}`;
  } catch {
    return "[invalid url]";
  }
}

/**
 * What a span may say about a failed request. An HTTP failure carries its status and never the
 * response body, which can echo the request URL in any encoding. Any other failure keeps its
 * message with the request URL replaced by its origin, because native `fetch` repeats the whole
 * URL, userinfo included, when it refuses one. The error a caller catches is not changed.
 */
function describeFailure(span: Span, error: unknown, url: string): void {
  if (error instanceof HttpError) {
    span.setAttribute("http.response.status_code", error.status);
    setSpanMessage(error, `HTTP ${String(error.status)}`);
  } else if (error instanceof Error) {
    setSpanMessage(error, scrubUrl(error.message, url));
  }
}

/** `text` with the request URL, as given and as normalized, replaced by its origin. */
function scrubUrl(text: string, url: string): string {
  const origin = redactUrlForLog(url);
  const normalized = URL.canParse(url) ? new URL(url).href : url;
  return text.replaceAll(url, origin).replaceAll(normalized, origin);
}

async function backoff(
  error: unknown,
  attempt: number,
  url: string,
  logger?: Logger,
): Promise<void> {
  const delay = retryDelayMs(error, attempt);
  logger?.warn(
    { url: redactUrlForLog(url), attempt, delayMs: delay },
    "http request failed, retrying",
  );
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
  } else if (options.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(options.form).toString();
  }
  return { headers, body, method: options.method ?? "GET" };
}

async function doFetchJson<T>(
  url: string,
  options: HttpRequestOptions,
  timeoutMs: number,
): Promise<T> {
  const response = await doFetchResponse(url, options, timeoutMs);
  return (await response.json()) as T;
}

async function doFetchText(
  url: string,
  options: HttpRequestOptions,
  timeoutMs: number,
): Promise<string> {
  const response = await doFetchResponse(url, options, timeoutMs);
  return await response.text();
}

async function doFetchStatus(
  url: string,
  options: HttpRequestOptions,
  timeoutMs: number,
): Promise<number> {
  const response = await doFetchResponse(url, options, timeoutMs, false);
  await discardBody(response);
  return response.status;
}

async function doFetchBytes(
  url: string,
  options: HttpRequestOptions,
  timeoutMs: number,
): Promise<Buffer> {
  const response = await doFetchResponse(url, options, timeoutMs);
  return Buffer.from(await response.arrayBuffer());
}

async function doFetchResponse(
  url: string,
  options: HttpRequestOptions,
  timeoutMs: number,
  readErrorBody = true,
): Promise<Response> {
  const request = buildRequest(options);
  injectTraceContext(request.headers);
  options.logger?.debug({ url: redactUrlForLog(url), method: request.method }, "http request");
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  const response =
    options.destination === "project"
      ? await guardedFetch(url, { ...request, signal })
      : await fetch(url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          signal,
        });
  if (!response.ok) {
    throw await failureOf(response, readErrorBody);
  }
  return response;
}

/**
 * Cancel an unread body. Cleanup only: a rejected cancel must never replace the request's outcome,
 * or a delivered request would look failed and be retried.
 */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The status is already known; there is nothing left to do with the body.
  }
}

/** The {@link HttpError} for a non-2xx response; the body is read (and capped) only on request. */
async function failureOf(response: Response, readBody: boolean): Promise<HttpError> {
  if (!readBody) {
    await discardBody(response);
    return new HttpError(response.status, "", response.headers);
  }
  const text = await response.text();
  return new HttpError(response.status, text.slice(0, MAX_BODY_SNIPPET), response.headers);
}
