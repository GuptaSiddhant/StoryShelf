/** How a connect failure is classified (ADR 0007, decision 4): retried or not, and what it does to the target. */
import { isRetryableConnectError } from "../utils/connect-retry.ts";
import { errorText } from "../utils/error-text.ts";
import { redactUrlForLog } from "../utils/http.ts";
import { redactSecrets } from "../utils/redact.ts";

/** What a connect failure means for the retry loop and for the target. */
export interface RemoteConnectErrorOptions {
  /** `false` stops the retries and fails the job (default `true`: retried). */
  transient?: boolean | undefined;
  /**
   * For `transient: false`: `target` (default) also marks the target unavailable until restart,
   * `job` fails only this job and keeps the target offered (a per-shard server that is gone).
   */
  scope?: "target" | "job" | undefined;
  /** A lease the failed `connect` already took, released as `failed`. */
  lease?: unknown;
  cause?: unknown;
}

/** An error a function `connect` throws to say how the runner should treat the failure. */
export class RemoteConnectError extends Error {
  override readonly name = "RemoteConnectError";
  readonly transient: boolean;
  readonly scope: "target" | "job";
  readonly lease: unknown;

  constructor(message: string, options: RemoteConnectErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.transient = options.transient ?? true;
    this.scope = options.scope ?? "target";
    this.lease = options.lease;
  }
}

/** Marks the error of a `connect` abandoned because the run was cancelled or the process is shutting down. */
const STOPPED = Symbol("remote connect stopped");

/** The error of a `connect` that was cancelled or cut short by shutdown: never retried. */
export function stoppedError(): Error {
  return Object.assign(new Error("cancelled while connecting"), { [STOPPED]: true });
}

/** What a connect error means: whether to retry it, and whether it marks the target unavailable. */
export function classify(error: unknown): { retry: boolean; unavailable: boolean } {
  if (typeof error === "object" && error !== null && STOPPED in error) {
    return { retry: false, unavailable: false };
  }
  if (error instanceof RemoteConnectError) {
    return { retry: error.transient, unavailable: !error.transient && error.scope !== "job" };
  }
  const retry = isRetryableConnectError(error);
  return { retry, unavailable: !retry };
}

/** Longest provider text kept in a connect error. */
const PROVIDER_TEXT_MAX = 300;
/** A URL runs to the next space or angle bracket, quotes included: a quoted query value is part of it. */
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>]+/giu;
/** The value of an `Authorization` header, whatever its length: the header names it as a credential. */
const AUTH_HEADER_IN_TEXT = /\b(?<header>authorization\W{0,3}(?:bearer|basic))\s+[^\s,;]+/giu;
/**
 * A Bearer/Basic value with no header around it: only when it looks like a credential (eight or more
 * characters, or any digit, `=`, `+` or `/`), so prose such as "Basic auth is off" is left alone.
 */
const AUTH_VALUE_IN_TEXT =
  /\b(?<scheme>bearer|basic)\s+(?:(?=[\w.~+/=-]{8,})|(?=[\w.~+/=-]*[\d=+/]))[\w.~+/=-]+/giu;

/**
 * Provider text without its secrets, in an order that matters. A URL is cut to its origin first,
 * while it is still a whole URL (the shared patterns would otherwise rewrite its userinfo and leave
 * a path behind). The shared `key=value` patterns run next, while a word such as `password:` still
 * sits next to its value. The Bearer/Basic rewrite comes last, because it would hide that key.
 */
function withoutSecrets(text: string): string {
  return redactSecrets(text.replaceAll(URL_IN_TEXT, (url) => redactUrlForLog(url)))
    .replaceAll(AUTH_HEADER_IN_TEXT, "$<header> [redacted]")
    .replaceAll(AUTH_VALUE_IN_TEXT, "$<scheme> [redacted]");
}

/**
 * A provider's thrown value as a {@link RemoteConnectError}: transient unless it says `transient: false`.
 * Its text is all the error keeps of the provider's: URLs cut to their origin, header values and
 * known secret shapes redacted, bounded. The thrown value is not kept as `cause`, because a cause
 * would carry the raw text to whatever walks it.
 */
export function connectErrorOf(error: unknown): RemoteConnectError {
  const flags = (typeof error === "object" && error !== null ? error : {}) as {
    transient?: unknown;
    scope?: unknown;
    lease?: unknown;
  };
  const text = errorText(error, { maxLength: PROVIDER_TEXT_MAX, scrub: withoutSecrets });
  return new RemoteConnectError(`acquire failed: ${text}`, {
    transient: flags.transient !== false,
    scope: flags.scope === "job" ? "job" : "target",
    lease: flags.lease,
  });
}
