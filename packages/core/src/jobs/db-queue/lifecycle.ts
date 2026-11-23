/** Lifecycle of the database queue: the database adapter owns its connection, the queue its waiters. */
import type { AdapterLifecycle } from "../../adapters/metadata.ts";
import type { QueueRuntime } from "./types.ts";

/** Id no row ever has: the health probe is a primary-key read that finds nothing. */
const HEALTH_PROBE_ID = "~health";

/**
 * Setup is a no-op (the database adapter's own setup creates `capture_jobs`); teardown releases any
 * poll waiting on a local wake; health reads the table by primary key.
 */
export function buildQueueLifecycle(rt: QueueRuntime): AdapterLifecycle {
  return {
    setup: async () => {
      await Promise.resolve();
    },
    teardown: async () => {
      rt.wake.close();
      await Promise.resolve();
    },
    health: async () => {
      try {
        await rt.model.get(HEALTH_PROBE_ID);
        return { ok: true };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
