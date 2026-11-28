/**
 * Secret redaction for adapter errors, health details, and logs.
 *
 * Adapter-thrown messages routinely embed connection strings and tokens.
 * Every surface that exposes adapter text (503 gate, health report, error
 * logs) must pass through here before truncation or transport.
 */

import {
  STORYBOOK_EXCHANGE_PREFIX,
  STORYBOOK_READ_PREFIX,
  STORYBOOK_TOKEN_PREFIX,
  STORYBOOK_TOKEN_SOURCE,
} from "./storybook-prefixes.ts";

const SECRET_PATTERNS: RegExp[] = [
  /(:\/\/)[^/\s:]+:[^/\s@]+(?=@)/u,
  /([?&#](?:token|secret|password|api[_-]?key|auth[_-]?token|access[_-]?key)=)[^&#\s]*/giu,
  /((?:password|passwd|secret|token|api[_-]?key|auth[_-]?token|client[_-]?secret|access[_-]?key|private[_-]?key)\s*[:=]\s*['"]?)[^\s'";,[\]&]+/giu,
  new RegExp(`(${STORYBOOK_TOKEN_PREFIX})${STORYBOOK_TOKEN_SOURCE}`, "gu"),
  new RegExp(`(${STORYBOOK_READ_PREFIX})${STORYBOOK_TOKEN_SOURCE}`, "gu"),
  /([?&]X-Amz-(?:Signature|Security-Token|Credential)=)[^&#\s]*/giu,
  new RegExp(`(${STORYBOOK_EXCHANGE_PREFIX})${STORYBOOK_TOKEN_SOURCE}`, "gu"),
  /AKIA[0-9A-Z]{16}/gu,
  /gh[pous]_[A-Za-z0-9_]+/gu,
  /github_pat_[A-Za-z0-9_]+/gu,
  /glpat-[A-Za-z0-9_-]+/gu,
  /xox[bpasr]-[A-Za-z0-9-]+/gu,
  /sk-ant-[A-Za-z0-9_-]+/gu,
  /eyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]+/gu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
];

/** Replace embedded secrets with `[redacted]`. Never throws on weird input. */
export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, (...args: unknown[]) => {
      const group = args[1];
      return typeof group === "string" ? `${group}[redacted]` : "[redacted]";
    });
  }
  return redacted;
}

/** Redact secrets, then truncate to `maxLength`. */
export function sanitizeErrorText(text: string, maxLength: number): string {
  const redacted = redactSecrets(text);
  return redacted.length > maxLength ? redacted.slice(0, maxLength) : redacted;
}

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

/** Characters of a webhook URL's last path segment that stay visible, and the shortest segment that may show them. */
const MASK_TAIL = 4;
const MASK_MIN_SEGMENT = 12;

/**
 * A URL for a person to recognise, never to use: its origin and, when the path ends in a long
 * enough segment (an incoming-webhook token), `/…/` plus that segment's last four characters, as
 * `https://hooks.slack.com/…/abcd`. A short or missing last segment shows only `/…` or nothing, so
 * the tail never gives away a meaningful part of the secret. The userinfo, query and fragment are
 * dropped by construction. Use it wherever a stored webhook or channel URL is displayed.
 */
export function maskUrlForDisplay(url: string): string {
  try {
    const parsed = new URL(url);
    const origin = `${parsed.protocol}//${parsed.host}`;
    const segments = parsed.pathname.split("/").filter((segment) => segment !== "");
    const last = segments.at(-1);
    if (last === undefined) {
      return origin;
    }
    return last.length >= MASK_MIN_SEGMENT && segments.length > 1
      ? `${origin}/…/${last.slice(-MASK_TAIL)}`
      : `${origin}/…`;
  } catch {
    return "[invalid url]";
  }
}
