/** Render-settled signalling: wait for Storybook's own "render finished" event, not a clock. */

import type { Page } from "playwright-core";

/** What the page knew when the wait ended (all of it from Storybook's public channel events). */
export interface SettleReport {
  /** Storybook announced the story rendered, finished, errored or missing before the timeout. */
  settled: boolean;
  /** The preview's channel was found, so events could have arrived at all. */
  hooked: boolean;
  /** The last `storyRenderPhaseChanged` phase seen (`playing`, `errored`, `completed` ...). */
  phase: string | null;
  /** Milliseconds the wait took. */
  elapsedMs: number;
  /** The story failed to render (`storyThrewException`, `storyErrored`, `storyMissing`). */
  renderError?: string;
  /** The play function (or a `.test()` body) threw (`playFunctionThrewException`). */
  playError?: string;
  /** Errors Storybook reported after the play function (`unhandledErrorsWhilePlaying`). */
  unhandled?: string[];
}

/** How long to wait for the event when nothing else says (the play timeout raises it). */
export const DEFAULT_SETTLE_TIMEOUT_MS = 5000;

/** The wait for the event: the context's override, else the play timeout when plays run, else 5 s. */
export function settleTimeoutOf(ctx: {
  settleTimeoutMs?: number | undefined;
  executePlay?: boolean | undefined;
  playTimeoutMs?: number | undefined;
}): number {
  if (ctx.settleTimeoutMs !== undefined) return ctx.settleTimeoutMs;
  return ctx.executePlay
    ? Math.max(DEFAULT_SETTLE_TIMEOUT_MS, ctx.playTimeoutMs ?? 0)
    : DEFAULT_SETTLE_TIMEOUT_MS;
}

/** Register the recorder on a page, once; it runs before the page's own scripts on every load. */
export async function installSettleRecorder(page: Page): Promise<void> {
  await page.addInitScript(inPageRecorder);
}

/** Wait until Storybook says the story is done (or `timeoutMs` passes); never throws. */
export async function waitForSettled(
  page: Page,
  timeoutMs: number,
  requireFinished = false,
): Promise<SettleReport> {
  try {
    const report: unknown = await page.evaluate(inPageWaitSettled, {
      timeoutMs,
      ...(requireFinished ? { requireFinished } : {}),
    });
    return isSettleReport(report) ? report : unsettled(false);
  } catch {
    return unsettled(false);
  }
}

/** A report for a wait that saw no signal. */
export function unsettled(hooked: boolean): SettleReport {
  return { settled: false, hooked, phase: null, elapsedMs: 0 };
}

function isSettleReport(value: unknown): value is SettleReport {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record["settled"] === "boolean" && typeof record["hooked"] === "boolean";
}

/**
 * Runs in the browser before the page's scripts, on every document. It watches the preview's
 * channel (`__STORYBOOK_ADDONS_CHANNEL__`, the public `Channel.on` API; nothing is patched) and
 * records the events StoryShelf needs. Playwright serializes only this function's source, so it
 * must not reference anything from this module; `settle.test.ts` evaluates it without bindings.
 */
// oxlint-disable-next-line eslint/max-statements, eslint/max-lines-per-function -- must stay one self-contained function (see above)
export function inPageRecorder(): void {
  type Channel = { on: (event: string, cb: (payload: unknown) => void) => void };
  type State = Record<string, unknown> & {
    hooked: boolean;
    settled: boolean;
    finished: boolean;
    phase: string | null;
    unhandled: string[];
    hook: () => boolean;
  };
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope["__STORYSHELF_SETTLE__"]) return;
  const state: State = {
    hooked: false,
    settled: false,
    finished: false,
    phase: null,
    unhandled: [],
    hook: () => false,
  };
  const text = {
    of(payload: unknown): string {
      if (typeof payload === "string") return payload;
      const record = (payload ?? {}) as Record<string, unknown>;
      const found = record["message"] ?? record["description"] ?? record["title"];
      return typeof found === "string" ? found : "unknown error";
    },
  };
  const markSettled = (): void => {
    state.settled = true;
  };
  const failRender = (payload: unknown): void => {
    state["renderError"] = text.of(payload);
    markSettled();
  };
  const handlers: Record<string, (payload: unknown) => void> = {
    storyRenderPhaseChanged: (payload) => {
      const phase = (payload as { newPhase?: unknown } | undefined)?.newPhase;
      if (typeof phase === "string") state.phase = phase;
    },
    storyRendered: markSettled,
    storyFinished: (payload) => {
      const status = (payload as { status?: unknown } | undefined)?.status;
      if (status === "error" && state["playError"] === undefined) {
        state["playError"] = "Storybook reported that the test failed";
      }
      state.finished = true;
      markSettled();
    },
    storyThrewException: failRender,
    storyErrored: failRender,
    storyMissing: failRender,
    playFunctionThrewException: (payload) => {
      state["playError"] = text.of(payload);
    },
    unhandledErrorsWhilePlaying: (payload) => {
      for (const error of Array.isArray(payload) ? payload : [payload]) {
        state.unhandled.push(text.of(error));
      }
    },
  };
  state.hook = (): boolean => {
    if (state.hooked) return true;
    const found = (scope["__STORYBOOK_ADDONS_CHANNEL__"] ??
      (scope["__STORYBOOK_PREVIEW__"] as { channel?: unknown } | undefined)?.channel) as
      | Channel
      | undefined;
    if (!found || typeof found.on !== "function") return false;
    for (const [event, handler] of Object.entries(handlers)) found.on(event, handler);
    state.hooked = true;
    return true;
  };
  scope["__STORYSHELF_SETTLE__"] = state;
  // The channel is created by iframe.html's bundle, before the first story renders: catch it
  // within a few ms. Give up after a while (a page that is not Storybook never gets one).
  if (state.hook()) return;
  const started = Date.now();
  const timer = setInterval(() => {
    if (state.hook() || Date.now() - started > 30_000) clearInterval(timer);
  }, 2);
}

/** Arguments serialized into the page for {@link inPageWaitSettled}. */
export interface SettleArgs {
  timeoutMs: number;
  requireFinished?: boolean;
}

/**
 * Runs in the browser: resolves when the recorder saw a terminal event, the page has no channel
 * to listen to, or `timeoutMs` passed. Self-contained for the same reason as the recorder.
 */
// oxlint-disable-next-line eslint/max-statements, eslint/max-lines-per-function -- must stay one self-contained function (see above)
export async function inPageWaitSettled({
  timeoutMs,
  requireFinished,
}: SettleArgs): Promise<SettleReport> {
  type State = {
    hooked: boolean;
    settled: boolean;
    finished: boolean;
    phase: string | null;
    unhandled: string[];
    hook: () => boolean;
    renderError?: string;
    playError?: string;
  };
  const state = (globalThis as unknown as Record<string, State | undefined>)[
    "__STORYSHELF_SETTLE__"
  ];
  const started = performance.now();
  const report = (settled: boolean, hooked: boolean): SettleReport => ({
    settled,
    hooked,
    phase: state?.phase ?? null,
    elapsedMs: Math.round(performance.now() - started),
    ...(state?.renderError === undefined ? {} : { renderError: state.renderError }),
    ...(state?.playError === undefined ? {} : { playError: state.playError }),
    ...(state && state.unhandled.length > 0 ? { unhandled: [...state.unhandled] } : {}),
  });
  if (!state) return report(false, false);
  // After `load` every script has run: no channel by now means there will never be one.
  if (!state.hook() && globalThis.document?.readyState === "complete") return report(false, false);
  while (performance.now() - started < timeoutMs) {
    if (state.settled && (!requireFinished || state.finished || state.renderError !== undefined)) {
      return report(true, true);
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- polling the recorded state
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  return report(
    state.settled && (!requireFinished || state.finished || state.renderError !== undefined),
    state.hook(),
  );
}

/** After the signal: let web fonts finish and two frames paint, so the screenshot sees the final DOM. */
export async function awaitPaint(page: Page): Promise<void> {
  try {
    await page.evaluate(inPagePaint);
  } catch {
    // best-effort: the screenshot still follows
  }
}

/** Runs in the browser; bounded so a page that never paints (hidden tab) cannot hang the capture. */
export async function inPagePaint(): Promise<void> {
  const scope = globalThis as unknown as {
    document: { fonts?: { ready: Promise<unknown> } };
    requestAnimationFrame: (cb: () => void) => void;
  };
  const frames = new Promise<void>((resolve) => {
    scope.requestAnimationFrame(() => {
      scope.requestAnimationFrame(() => {
        resolve();
      });
    });
  });
  const cap = new Promise<void>((resolve) => {
    setTimeout(resolve, 250);
  });
  await Promise.race([Promise.all([scope.document.fonts?.ready, frames]), cap]);
}
