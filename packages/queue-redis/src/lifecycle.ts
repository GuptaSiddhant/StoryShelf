/** Queue lifecycle: setup probe, health check, and owned-client teardown. */
import type { PollableCaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import type { Redis } from "ioredis";

/** All-or-nothing lifecycle: ping on setup, quit owned clients on teardown. */
export function buildQueueLifecycle(
  client: Redis,
  ownsClient: boolean,
): PollableCaptureQueue["lifecycle"] {
  return {
    setup: async () => {
      await client.ping();
    },
    teardown: async () => {
      if (ownsClient) {
        await client.quit().catch(() => {});
      }
    },
    health: async () => {
      await client.ping();
      return { ok: true };
    },
  };
}
