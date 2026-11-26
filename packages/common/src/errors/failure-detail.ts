import { sanitizeErrorText } from "../redact/redact.ts";
/**
 * What a failed operation says about itself, stored the same way everywhere it is kept (an attempt
 * log line, a render failure): the thrown value's `name` and `message`, the step that threw it and
 * its cause chain, every string redacted and bounded. A thrown value whose message is only its type
 * (`UnknownError`) still tells which step failed and what sat behind it.
 */
import { errorMessage } from "./error-text.ts";

const NAME_MAX = 80;
const MESSAGE_MAX = 300;
const STEP_MAX = 40;
/** Causes kept behind the outermost error. */
const MAX_CAUSES = 3;
/** The whole text form, so one chatty failure cannot flood a row. */
const TEXT_MAX = 500;
const NOT_AN_ERROR = "ThrownValue";

/** One link of a failure: an error's kind and what it said. */
export interface FailureLink {
  name: string;
  message: string;
}

/** A failure as stored: the outermost error, the step that threw it and what caused it. */
export interface FailureDetail extends FailureLink {
  /** The step that threw (navigate, settle, screenshot ...); absent when none was recorded. */
  step?: string;
  /** Causes, nearest first, at most {@link MAX_CAUSES}. */
  causes?: FailureLink[];
}

/** Options of {@link failureDetail}. */
export interface FailureDetailOptions {
  /** The step that threw. */
  step?: string | undefined;
  /** Removes the caller's exact secrets (a connection's endpoint and headers) before redaction. */
  scrub?: ((text: string) => string) | undefined;
}

type Shown = (text: string, max: number) => string;

/**
 * The failure behind any thrown value: `name`, own `message`, `step` and up to three causes, each
 * string passed through `scrub`, then `redactSecrets`, then cut. Cycle-safe; never throws. A value
 * that is already a `FailureDetail` is re-sanitized, so a logger can apply it to what a runner built.
 */
export function failureDetail(error: unknown, options: FailureDetailOptions = {}): FailureDetail {
  const { scrub } = options;
  const shown: Shown = (text, max) =>
    sanitizeErrorText(scrub === undefined ? text : scrub(text), max);
  const links = linksOf(error);
  const [first, ...rest] = links;
  const detail: FailureDetail = {
    name: shown(first?.name ?? NOT_AN_ERROR, NAME_MAX),
    message: shown(first?.message ?? "", MESSAGE_MAX),
  };
  const step = options.step ?? stepOfDetail(error);
  if (step !== undefined && step !== "") detail.step = shown(step, STEP_MAX);
  if (rest.length > 0) {
    detail.causes = rest.slice(0, MAX_CAUSES).map((link) => ({
      name: shown(link.name, NAME_MAX),
      message: shown(link.message, MESSAGE_MAX),
    }));
  }
  return detail;
}

/** One bounded line: `step: Name: message (caused by Name: message; ...)`. */
export function failureText(detail: FailureDetail): string {
  const own = [detail.name, detail.message].filter((part) => part !== "").join(": ");
  const head = detail.step === undefined ? own : `${detail.step}: ${own}`;
  const causes = (detail.causes ?? [])
    .map((link) => [link.name, link.message].filter((part) => part !== "").join(": "))
    .join("; ");
  const text = causes === "" ? head : `${head} (caused by ${causes})`;
  return text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) : text;
}

function stepOfDetail(value: unknown): string | undefined {
  const step = fieldOf(value, "step");
  return typeof step === "string" ? step : undefined;
}

/** The value and its causes as links, outermost first; a detail's own `causes` follow it. */
function linksOf(value: unknown): FailureLink[] {
  const detailCauses = fieldOf(value, "causes");
  if (Array.isArray(detailCauses) && typeof fieldOf(value, "name") === "string") {
    return [linkOf(value), ...detailCauses.map((cause: unknown) => linkOf(cause))];
  }
  return causeChain(value);
}

function causeChain(value: unknown): FailureLink[] {
  const links: FailureLink[] = [];
  const seen = new Set<unknown>();
  let current: unknown = value;
  while (current !== undefined && current !== null && !seen.has(current)) {
    if (links.length > MAX_CAUSES) break;
    seen.add(current);
    links.push(linkOf(current));
    current = fieldOf(current, "cause");
  }
  return links;
}

function linkOf(value: unknown): FailureLink {
  const name = fieldOf(value, "name");
  const kind = value instanceof Error ? "Error" : NOT_AN_ERROR;
  return {
    name: typeof name === "string" && name !== "" ? name : kind,
    message: value instanceof Error ? value.message : messageOfLink(value),
  };
}

function messageOfLink(value: unknown): string {
  const text = errorMessage(value);
  return text === "unknown error" ? "" : text;
}

/** A property read that a throwing getter or proxy cannot break. */
function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}
