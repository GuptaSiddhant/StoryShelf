/** Time of the database queue: every timestamp it writes or compares comes from the runtime clock. */
import type { QueueRuntime } from "./types.ts";

/** ISO-8601 time `plusMs` from now on the queue's clock. */
export function isoAt(rt: Pick<QueueRuntime, "now">, plusMs = 0): string {
  return new Date(rt.now() + plusMs).toISOString();
}
