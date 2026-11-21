/**
 * `storyshelf upload --wait`: follow a build until it stops needing the server, then map how it
 * ended to an exit code. It never waits for a person (`reviewing` ends the wait), never cancels
 * the build, and prints no token or signed URL.
 */
import { RequestError, type BuildState, type createClient } from "../client.ts";
import { printLine, type Reporter } from "../output.ts";
export { WAIT_EXIT_HELP } from "./wait-help.ts";

/** Exit codes of `upload --wait`. 1 stays the CLI's own errors (config, network, auth, the upload). */
export const WAIT_EXIT = {
  approved: 0,
  needsReview: 2,
  rejected: 3,
  failed: 4,
  cancelled: 5,
  timedOut: 6,
} as const;

/** Poll cadence: first gap, growth and ceiling (design note on #1148). */
const FIRST_GAP_MS = 2000;
const MAX_GAP_MS = 10_000;
/** A poll that fails with one of these is tried again; anything else, or too many in a row, is exit 1. */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);
const MAX_TRANSIENT_IN_A_ROW = 5;

/** Default for `--timeout`. */
export const DEFAULT_WAIT_TIMEOUT_MS = 30 * 60 * 1000;

/** Everything the wait needs; `now`, `sleep` and `signal` are test seams. */
export interface WaitOptions {
  client: ReturnType<typeof createClient>;
  slug: string;
  buildId: string;
  /** Build page URL, when the server gave one. */
  buildLink: string | null;
  /** The server runs no capture (`testing: false`): the wait ends once the Storybook is published. */
  hostingOnly: boolean;
  timeoutMs: number;
  reporter: Reporter;
  /** Monotonic milliseconds. */
  now?: () => number;
  /** Resolve after `ms`, or earlier when `signal` aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Aborted by Ctrl+C: stops waiting, never the build. */
  signal?: AbortSignal;
}

/** How the wait ended: the exit code and the lines that say why (stdout). */
export interface WaitOutcome {
  code: number;
  lines: string[];
}

/** The verdict name of an exit code, as `upload --json` reports it. */
export function verdictName(code: number): string {
  const names: Record<number, string> = {
    [WAIT_EXIT.approved]: "approved",
    [WAIT_EXIT.needsReview]: "needs-review",
    [WAIT_EXIT.rejected]: "rejected",
    [WAIT_EXIT.failed]: "failed",
    [WAIT_EXIT.cancelled]: "cancelled",
    [WAIT_EXIT.timedOut]: "timeout",
  };
  return names[code] ?? "interrupted";
}

/** Thrown inside a phase when waiting stops without a verdict, so the phase line says it failed. */
class WaitStoppedError extends Error {
  readonly reason: "timeout" | "interrupted";
  readonly last: BuildState | null;

  constructor(reason: "timeout" | "interrupted", last: BuildState | null) {
    super(reason);
    this.name = "WaitStoppedError";
    this.reason = reason;
    this.last = last;
  }
}

/**
 * Follow the build until a verdict, the timeout or Ctrl+C. Returns the outcome and sets nothing:
 * the caller prints the lines and exits with the code.
 */
export async function waitForBuild(options: WaitOptions): Promise<WaitOutcome> {
  try {
    return await followToVerdict(options, createPoller(options));
  } catch (error) {
    if (error instanceof WaitStoppedError) {
      return stopped(options, error.last, error.reason);
    }
    throw error;
  }
}

/** The publishing phase, then the capture phase, each only while the build still needs it. */
async function followToVerdict(options: WaitOptions, poller: Poller): Promise<WaitOutcome> {
  let state = await poller.next();
  if (verdictOf(state, options) === null && state.publishing !== "success") {
    const from = state;
    state = await options.reporter.phase("Publishing", "Published", async (handle) => {
      return await poller.until(from, (s) => s.publishing !== "pending", handle, describeStage);
    });
  }
  if (verdictOf(state, options) === null) {
    const from = state;
    state = await options.reporter.phase("Capturing", "Captured", async (handle) => {
      return await poller.until(from, () => false, handle, describeCapture);
    });
  }
  return verdictOf(state, options) ?? stopped(options, state, "timeout");
}

/** The publishing phase shows no progress text. */
function describeStage(): string {
  return "";
}

/** `120/860 stories`, or `120 stories` while the total is unknown. */
function describeCapture(state: BuildState): string {
  const capture = state.capture;
  if (!capture) return "";
  return capture.total === null
    ? `${capture.done} stories`
    : `${capture.done}/${capture.total} stories`;
}

interface Poller {
  /** One poll, retrying a transient failure. */
  next: (failures?: number) => Promise<BuildState>;
  /** Poll until `done(state)` or the build has a verdict; throws {@link WaitStoppedError} on timeout or Ctrl+C. */
  until: (
    from: BuildState,
    done: (state: BuildState) => boolean,
    handle: { progress(text: string): void },
    describe: (state: BuildState) => string,
  ) => Promise<BuildState>;
}

/** Polling with backoff, a deadline and an abort signal, over the injected clock. */
function createPoller(options: WaitOptions): Poller {
  const now = options.now ?? ((): number => performance.now());
  const sleep = options.sleep ?? defaultSleep;
  const deadline = now() + options.timeoutMs;
  let gap = FIRST_GAP_MS;
  let last: BuildState | null = null;
  const stopIfDue = (): void => {
    if (options.signal?.aborted) throw new WaitStoppedError("interrupted", last);
    if (now() >= deadline) throw new WaitStoppedError("timeout", last);
  };
  const wait = async (ms: number): Promise<void> => {
    await sleep(Math.min(ms, Math.max(0, deadline - now())), options.signal);
    stopIfDue();
  };
  const next = async (failures = 0): Promise<BuildState> => {
    stopIfDue();
    try {
      const state = await options.client.projects.builds.get(options.slug, options.buildId);
      last = state;
      return state;
    } catch (error) {
      if (!isTransient(error) || failures + 1 >= MAX_TRANSIENT_IN_A_ROW) throw error;
      await wait(error instanceof RequestError ? (error.retryAfterMs ?? gap) : gap);
      return await next(failures + 1);
    }
  };
  return {
    next,
    until: async (from, done, handle, describe) => {
      let state = from;
      handle.progress(describe(state));
      while (!done(state) && verdictOf(state, options) === null) {
        // eslint-disable-next-line no-await-in-loop -- one poll at a time, spaced by the backoff
        await wait(gap);
        gap = Math.min(MAX_GAP_MS, Math.round(gap * 1.5));
        // eslint-disable-next-line no-await-in-loop -- see above
        state = await next();
        handle.progress(describe(state));
      }
      return state;
    },
  };
}

/** A poll worth repeating: a throttled or briefly unavailable server, or a dropped connection. */
function isTransient(error: unknown): boolean {
  return error instanceof RequestError
    ? TRANSIENT_STATUSES.has(error.status)
    : error instanceof TypeError;
}

/** Real sleep that ends early on abort. */
async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** The outcome when the build has stopped needing the server, else null (keep waiting). */
export function verdictOf(
  state: BuildState,
  options: Pick<WaitOptions, "hostingOnly" | "buildLink">,
): WaitOutcome | null {
  const link = options.buildLink;
  switch (state.status) {
    case "approved":
    case "skipped":
      return outcome(WAIT_EXIT.approved, "Build approved", link);
    case "rejected":
      return outcome(WAIT_EXIT.rejected, "Build rejected", link);
    case "failed":
      return outcome(WAIT_EXIT.failed, `Build failed: ${failureReason(state)}`, link);
    case "cancelled":
      return cancelledOutcome(state, link);
    case "reviewing":
      return outcome(WAIT_EXIT.needsReview, needsReviewText(state), link, "Review");
    default:
      return hostingOnlyVerdict(state, options);
  }
}

/** A hosting-only build has no capture: published means done, and a pending verdict is a review wait. */
function hostingOnlyVerdict(
  state: BuildState,
  options: Pick<WaitOptions, "hostingOnly" | "buildLink">,
): WaitOutcome | null {
  if (!options.hostingOnly) return null;
  if (state.publishing === "success") {
    return outcome(
      WAIT_EXIT.needsReview,
      "Storybook published; waiting for a review verdict",
      options.buildLink,
      "Review",
    );
  }
  if (state.publishing === "failure" || state.publishing === "unavailable") {
    return outcome(
      WAIT_EXIT.failed,
      "Build failed: the Storybook was not published",
      options.buildLink,
    );
  }
  return null;
}

function needsReviewText(state: BuildState): string {
  const n = state.changedCount;
  return n > 0
    ? `${n} visual ${n === 1 ? "change needs" : "changes need"} review`
    : "The build needs review";
}

/** Superseded builds name the newer build's link when it can be derived from this build's link. */
function cancelledOutcome(state: BuildState, link: string | null): WaitOutcome {
  const newer = state.supersededByBuildId;
  if (!newer) return outcome(WAIT_EXIT.cancelled, "Build cancelled", link);
  const newerLink = link === null ? null : link.replace(state.id, newer);
  return {
    code: WAIT_EXIT.cancelled,
    lines: [
      `Build superseded by build ${newer}`,
      ...(newerLink !== null && newerLink !== link ? [`Newer build: ${newerLink}`] : []),
    ],
  };
}

/** A short reason from what the poll carries: failing Storybook tests, an unpublished Storybook, or capture. */
function failureReason(state: BuildState): string {
  const tests = failingTests(state.testResults);
  if (tests > 0) return `${tests} Storybook ${tests === 1 ? "test" : "tests"} failed`;
  if (state.publishing === "failure") return "the Storybook could not be published";
  return "capture did not complete";
}

function failingTests(json: string | null | undefined): number {
  try {
    const results = JSON.parse(json ?? "[]") as { status?: string }[];
    return results.filter((r) => r.status === "failed").length;
  } catch {
    return 0;
  }
}

function outcome(code: number, text: string, link: string | null, label = "View"): WaitOutcome {
  return { code, lines: [text, ...(link === null ? [] : [`${label}: ${link}`])] };
}

/** Exit 6 for the timeout, 130 for Ctrl+C: either way the build keeps running. */
function stopped(
  options: Pick<WaitOptions, "buildLink">,
  last: BuildState | null,
  reason: "timeout" | "interrupted",
): WaitOutcome {
  const status = last?.status ?? "running";
  const text =
    reason === "timeout"
      ? `Timed out waiting: still ${status}; nothing was cancelled`
      : `Stopped waiting: still ${status}; nothing was cancelled`;
  return {
    code: reason === "timeout" ? WAIT_EXIT.timedOut : 130,
    lines: [text, ...(options.buildLink === null ? [] : [`View: ${options.buildLink}`])],
  };
}

/** Print an outcome's lines to stdout and return its code. */
export function reportOutcome(result: WaitOutcome): number {
  for (const line of result.lines) printLine(line);
  return result.code;
}

/** Parse `--timeout`: `90`, `90s`, `30m` or `2h`; a bare number is seconds. */
export function parseTimeout(value: string | number): number {
  const match = /^(\d+)(s|m|h)?$/u.exec(String(value).trim());
  if (match?.[1] === undefined || Number(match[1]) <= 0) {
    throw new Error(`--timeout "${String(value)}" is not a duration: use 90, 90s, 30m or 2h`);
  }
  const unit = { s: 1000, m: 60_000, h: 3_600_000 }[match[2] ?? "s"] ?? 1000;
  return Number(match[1]) * unit;
}
