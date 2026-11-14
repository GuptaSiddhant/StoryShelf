/**
 * Story-switching sessions (ADR 0052): one loaded page renders several stories in turn. The first
 * story of a session is a fresh load, exactly as without switching; each later one is reached by
 * switching inside the page. Anything uncertain ends the session, and the story it stopped at is
 * captured again as the first story of a new one, on a fresh load.
 */

import type { SessionJob, SwitchSession } from "@storyshelf/core/capture";
import { isTimeoutError } from "@storyshelf/core/utils";
import type { Page } from "playwright-core";
import { TransientCaptureError } from "./capture-retry.ts";
import { deliverCapture, pushRenderFailure, type Delivery } from "./deliver.ts";
import { trackRequests, type RequestTracker } from "./network-quiet.ts";
import { acquirePage } from "./pages.ts";
import { runCapture, watchCrash } from "./screenshot.ts";
import { captureSwitched, prepareSwitch, type SwitchEnd } from "./switch-capture.ts";
import { installDocumentRecorder } from "./switch-page.ts";
import type { ActiveRun, CaptureContext, PlaywrightRenderInput } from "./types.ts";

/** What a run's sessions did, for the attempt log (ADR 0052, decision 5). */
export interface SwitchStats {
  /** Captures taken after a switch. */
  switched: number;
  /** Sessions that ended before their last story, by reason. */
  ended: Partial<Record<SwitchEnd, number>>;
}

/** Everything one session needs from the run. */
export interface SessionRun {
  input: PlaywrightRenderInput;
  active: ActiveRun;
  ctx: CaptureContext;
  out: Delivery;
  stats: SwitchStats;
  /** Throws when the run must stop: cancelled, or its remote browser lost. */
  check: () => void;
}

/** Pages that already carry the document recorder (it is installed once per page). */
const recorded = new WeakSet<Page>();

/** Render one session; resolves to whether a capture timed out (for the adaptive page limiter). */
export async function runSession(run: SessionRun, session: SwitchSession): Promise<boolean> {
  const queue = [...session.jobs];
  let timedOut = false;
  for (let head = queue.shift(); head !== undefined; head = queue.shift()) {
    run.check();
    // oxlint-disable-next-line eslint/no-await-in-loop -- one page at a time per session
    timedOut = (await onePage(run, head, queue)) || timedOut;
  }
  return timedOut;
}

/** One loaded page: a fresh load of `head`, then switches through `queue` until the session ends. */
async function onePage(run: SessionRun, head: SessionJob, queue: SessionJob[]): Promise<boolean> {
  const lease = await acquirePage(run.ctx, head.viewport);
  const watch = await prepared(run, lease.page);
  try {
    await onPage(run, lease.page, head, { queue, requests: watch.requests });
    await lease.release(true);
    return false;
  } catch (error) {
    await lease.release(false);
    return failed(run, head, watch.classify(error));
  } finally {
    watch.dispose();
  }
}

/** What a session watches on its page: requests in flight and a crash. */
interface PageWatch {
  requests: RequestTracker;
  classify(error: unknown): unknown;
  dispose(): void;
}

/** A leased page made ready for a session: its timeout, the document recorder, request counting. */
async function prepared(run: SessionRun, page: Page): Promise<PageWatch> {
  if (run.ctx.navigationTimeoutMs) page.setDefaultTimeout(run.ctx.navigationTimeoutMs);
  if (!recorded.has(page)) {
    await installDocumentRecorder(page);
    recorded.add(page);
  }
  const requests = trackRequests(page);
  const crash = watchCrash(page);
  return {
    requests,
    classify: (error) => crash.classify(error),
    dispose: () => {
      requests.dispose();
      crash.dispose();
    },
  };
}

/** Record the first story's failure; resolves to whether it timed out. */
function failed(run: SessionRun, head: SessionJob, error: unknown): boolean {
  pushRenderFailure(run.out.failures, run.input, head.story.id, head.viewport.name, error);
  return isTimeoutError(error instanceof TransientCaptureError ? error.cause : error);
}

/** The head, loaded fresh, then the queue by switching, unless the head ended the session. */
async function onPage(
  run: SessionRun,
  page: Page,
  head: SessionJob,
  rest: { queue: SessionJob[]; requests: RequestTracker },
): Promise<void> {
  const ends = await freshHead(run, page, head);
  if (rest.queue.length === 0) return;
  if (ends === undefined) await switchThrough(run, page, rest.queue, rest.requests);
  else ended(run, head, ends);
}

/** The session's first story, loaded fresh; resolves to why the page may not be switched from. */
async function freshHead(
  run: SessionRun,
  page: Page,
  head: SessionJob,
): Promise<SwitchEnd | undefined> {
  const startedAt = performance.now();
  const outcome = await runCapture(page, run.ctx, head.story, head.viewport);
  await deliverCapture(run.input, run.out, head.viewport, { ...outcome, startedAt });
  return outcome.ends;
}

/**
 * Switch through the queue on this page until a story cannot be taken from it. A story that ends
 * the session before its capture stays at the head of the queue, to be loaded fresh; one whose
 * switch failed is never reported, only captured again.
 */
async function switchThrough(
  run: SessionRun,
  page: Page,
  queue: SessionJob[],
  requests: RequestTracker,
): Promise<void> {
  for (let next = queue[0]; next !== undefined; next = queue[0]) {
    run.check();
    // oxlint-disable-next-line eslint/no-await-in-loop -- one story after another on one page
    const step = await switchOnce(run, page, next, requests);
    if (step.taken) queue.shift();
    if (step.end !== undefined) {
      // A story taken but ending the session is not repeated: the next one starts the new page.
      ended(run, step.taken ? (queue[0] ?? next) : next, step.end, queue.length > 0);
      return;
    }
  }
}

/** One switch: whether the story was captured here, and why the session ends, if it does. */
async function switchOnce(
  run: SessionRun,
  page: Page,
  job: SessionJob,
  requests: RequestTracker,
): Promise<{ taken: boolean; end?: SwitchEnd | undefined }> {
  const drift = await prepareSwitch(page, job.viewport);
  if (drift !== null) return { taken: false, end: drift };
  const startedAt = performance.now();
  const outcome = await captureSwitched(page, run.ctx, job.story, job.viewport, requests).catch(
    (): SwitchEnd => "failed",
  );
  if (typeof outcome === "string") return { taken: false, end: outcome };
  run.stats.switched += 1;
  try {
    await deliverCapture(run.input, run.out, job.viewport, {
      ...outcome,
      startedAt,
      switched: true,
    });
  } catch (error) {
    pushRenderFailure(run.out.failures, run.input, job.story.id, job.viewport.name, error);
  }
  return { taken: true, end: outcome.ends };
}

/** Count and log a session that ended with stories still to render. */
function ended(run: SessionRun, job: SessionJob, reason: SwitchEnd, pending = true): void {
  if (!pending) return;
  run.stats.ended[reason] = (run.stats.ended[reason] ?? 0) + 1;
  run.input.logger?.info(
    { storyId: job.story.id, viewport: job.viewport.name, reason },
    "story switching session ended; the next story loads a fresh page",
  );
}
