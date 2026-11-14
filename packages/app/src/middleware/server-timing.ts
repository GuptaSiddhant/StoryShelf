/**
 * Opt-in `Server-Timing` on app HTML pages and `/api/v1` JSON answers (#872).
 *
 * Enabled only when `ShelfConfig.serverTiming` is true (default off). The header carries phase
 * names and durations only (`db`, `storage`, `render`, `total`), never an id, path, query or user
 * value: other names recorded in the scope are dropped. `db`/`storage` roll up the instrumented
 * adapter calls of the request; `render` is the time spent turning JSX into HTML (`c.html`);
 * `total` is the wall time of everything mounted after this middleware, compression included.
 *
 * Published files and short links (`/_/`), signed Storybook and read-grant routes (`/_s/`, `/_r/`,
 * `/_x/`) and assets are never touched: their headers are owned by their own helpers (AGENTS.md).
 * Mount it after `hostDispatch` so content and alias hosts never reach it. Background capture work
 * has no response; see attempt logs instead.
 */
import { roundedTimings, runWithTimings, timed } from "@storyshelf/core/utils";
import type { Context, MiddlewareHandler } from "hono";

/** The only phase names that may leave the process. */
const PHASES = ["db", "storage", "render"] as const;

/** Route families with their own response handling; mirrors the compression skip list. */
const UNTOUCHED = /^\/(?:_\/|_s\/|_r\/|_x\/|assets\/)/u;

const ANSWERS = /^(?:text\/html|application\/json)(?:\s*;|$)/iu;

/** Create the Server-Timing middleware (pass-through unless enabled). */
export function serverTiming(enabled: boolean): MiddlewareHandler {
  return async (c, next) => {
    if (!enabled || UNTOUCHED.test(c.req.path)) {
      await next();
      return;
    }
    const started = performance.now();
    instrumentRender(c);
    const { timings } = await runWithTimings(next);
    if (!ANSWERS.test(c.res.headers.get("Content-Type") ?? "")) {
      return;
    }
    timings["total"] = performance.now() - started;
    c.res.headers.append("Server-Timing", headerOf(roundedTimings(timings)));
  };
}

/** Count the JSX-to-HTML work of `c.html` under `render`. */
function instrumentRender(c: Context): void {
  const html = c.html.bind(c) as (...args: unknown[]) => unknown;
  (c as { html: unknown }).html = async (...args: unknown[]): Promise<unknown> =>
    await timed("render", () => html(...args));
}

/** `db;dur=3, render;dur=5, total;dur=12`: allow-listed names only, fixed order. */
function headerOf(timings: Record<string, number>): string {
  return [...PHASES, "total"]
    .filter((name) => timings[name] !== undefined)
    .map((name) => `${name};dur=${timings[name]}`)
    .join(", ");
}
