/** SQS queue probe lifecycle: setup, health, and teardown. */
import { GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import type { PollableCaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import type { SqsContext } from "./client.ts";

/** Probe queue access on setup/health; destroy owned clients on teardown. */
export function buildSqsLifecycle(
  ctx: SqsContext,
  ownsClient: boolean,
): PollableCaptureQueue["lifecycle"] {
  let destroyed = false;
  return {
    setup: async () => {
      await ctx.client.send(new GetQueueAttributesCommand({ QueueUrl: ctx.queueUrl }));
    },
    teardown: async () => {
      if (ownsClient && !destroyed) {
        destroyed = true;
        ctx.client.destroy();
      }
      await Promise.resolve();
    },
    health: async () => {
      await ctx.client.send(new GetQueueAttributesCommand({ QueueUrl: ctx.queueUrl }));
      return { ok: true };
    },
  };
}
