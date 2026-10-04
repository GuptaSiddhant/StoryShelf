/**
 * Opt-in `Server-Timing` response headers over Hono's timing middleware.
 *
 * Enabled only when `ShelfConfig.serverTiming` is true (default off — some
 * deployments prefer no timing headers). The `total` metric matches the
 * `http.server` span; `db`/`storage` are roll-ups of the instrumented
 * adapter calls in this request (same family names as the `db.*` spans;
 * per-operation detail stays in traces). Background capture work never
 * appears here — it has no response; see attempt logs instead.
 */
import { runWithTimings } from "@storyshelf/core/utils";
import type { Context, Next } from "hono";
import { setMetric, timing } from "hono/timing";

/** Create the Server-Timing middleware (pass-through unless enabled). */
export function serverTiming(enabled: boolean) {
  const inner = timing({ total: true, enabled: false });
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (!enabled) {
      await next();
      return;
    }
    const { timings } = await runWithTimings(async () => {
      await inner(c as never, next);
    });
    for (const [name, ms] of Object.entries(timings).toSorted((a, b) => a[0].localeCompare(b[0]))) {
      setMetric(c, name, ms);
    }
    const headers = (c.get("metric") as { headers: string[] } | undefined)?.headers ?? [];
    if (headers.length > 0) {
      c.res.headers.append("Server-Timing", headers.join(","));
    }
  };
}
