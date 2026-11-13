/** Setup, teardown and health shared by every driver built on {@link createDrizzleAdapter}. */
import type { DatabaseAdapter, DrizzleAdapterOptions } from "@storyshelf/core/adapter/database";

/** Setup, teardown (once) and health for the adapter; teardown closes the driver a single time. */
export function buildLifecycle(
  options: DrizzleAdapterOptions,
): NonNullable<DatabaseAdapter["lifecycle"]> {
  let closed = false;
  return {
    setup: async (context) => {
      await options.migrate({ logger: context.logger, release: context.release });
    },
    teardown: async () => {
      if (closed) {
        return;
      }
      closed = true;
      await options.close();
    },
    health: async () => {
      if (closed) {
        return { ok: false, detail: "database closed" };
      }
      if (options.ping) {
        await options.ping();
      }
      return { ok: true };
    },
  };
}
