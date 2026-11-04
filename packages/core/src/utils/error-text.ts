/**
 * What a thrown value says, for messages and for classifying a failure. Anything can be thrown: an
 * `Error`, a WebSocket or `ErrorEvent`, a plain object, a string. `String(value)` turns the objects
 * into `[object Object]` and loses the cause, so a remote browser that failed to connect read
 * `Cannot launch chromium@farm: [object Object]`.
 */
import { sanitizeErrorText } from "./redact.ts";

const MAX_DEPTH = 4;
const MAX_LENGTH = 500;
const UNKNOWN = "unknown error";

/**
 * The message of a thrown value, as it is: an `Error`'s own message exactly (so an `Error` classifies
 * as it always has), otherwise what the shape says: a string whole, an object's `message`, else the
 * message of its nested `error` or `cause`, else its `reason`, else its `type` (`error event`), with
 * a `code` appended. Never `[object Object]`; a value that says nothing reads `unknown error`.
 * Not sanitized and not truncated: use {@link errorText} for anything shown or logged.
 */
export function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : (describe(value, new Set(), 0) ?? UNKNOWN);
}

/** Options of {@link errorText}. */
export interface ErrorTextOptions {
  /** Longest text returned (default 500). */
  maxLength?: number;
  /** Removes the caller's exact secrets from the whole text, before redaction and truncation. */
  scrub?: (text: string) => string;
}

/**
 * A thrown value for people: its message and its cause chain (at most four links, each cause that
 * the text so far does not already contain, cycle-safe), secrets redacted and the whole bounded to
 * `maxLength` (500). A caller that knows exact secrets (a connection's endpoint and headers) passes
 * `scrub`, which runs on the whole text before the pattern redaction and the cut: the pattern
 * redaction would otherwise rewrite part of the endpoint so it no longer matches, and a cut could
 * leave half of a secret behind.
 */
export function errorText(value: unknown, options: ErrorTextOptions = {}): string {
  const parts = chainOf(value);
  const text = parts.length > 0 ? parts.join(": ") : UNKNOWN;
  const scrubbed = options.scrub === undefined ? text : options.scrub(text);
  return sanitizeErrorText(scrubbed, options.maxLength ?? MAX_LENGTH);
}

/** The distinct messages of the value and its causes, outermost first. */
function chainOf(value: unknown): string[] {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = value;
  // At most MAX_DEPTH links are visited, repeated messages included, so a long chain of the same
  // message cannot make this loop long.
  for (let link = 0; link < MAX_DEPTH && current !== undefined && current !== null; link += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    const text = shown(current);
    if (text !== "" && !parts.some((part) => part.includes(text))) parts.push(text);
    current = causeOf(current);
  }
  return parts;
}

/** One link of the chain as shown: an `Error` with no message still names its kind. */
function shown(value: unknown): string {
  const text = errorMessage(value).trim();
  if (text !== "" || !(value instanceof Error)) return text;
  return value.name;
}

function causeOf(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    return (value as { cause?: unknown }).cause;
  } catch {
    return undefined;
  }
}

function describe(value: unknown, seen: Set<object>, depth: number): string | undefined {
  if (typeof value === "string") return value.trim() === "" ? undefined : value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value !== "object" || value === null || depth >= MAX_DEPTH || seen.has(value)) {
    return undefined;
  }
  if (value instanceof Error) return value.message === "" ? undefined : value.message;
  seen.add(value);
  try {
    return describeObject(value as Record<string, unknown>, seen, depth);
  } catch {
    // A getter or proxy that throws says nothing.
    return undefined;
  }
}

function describeObject(
  fields: Record<string, unknown>,
  seen: Set<object>,
  depth: number,
): string | undefined {
  const text =
    describe(fields["message"], seen, depth + 1) ??
    describe(fields["error"], seen, depth + 1) ??
    describe(fields["cause"], seen, depth + 1) ??
    describe(fields["reason"], seen, depth + 1) ??
    typeName(fields["type"]);
  return text === undefined ? undefined : withCode(text, fields["code"]);
}

/** `error` becomes `error event`: the kind of an event object that carries nothing else. */
function typeName(type: unknown): string | undefined {
  return typeof type === "string" && type !== "" ? `${type} event` : undefined;
}

function withCode(text: string, code: unknown): string {
  const shownCode = typeof code === "number" || typeof code === "string" ? String(code) : "";
  return shownCode === "" || text.includes(shownCode) ? text : `${text} (code ${shownCode})`;
}
