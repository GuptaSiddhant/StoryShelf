/** Pub/Sub lifecycle: setup, health, and teardown. */
import { subscriptionPath, topicPath } from "./codec.ts";
import type { GcpPubSubState } from "./types.ts";

/** Verify the topic exists before the queue accepts work. */
export async function setupPubSub(state: GcpPubSubState): Promise<void> {
  await state.publisher.getTopic({ topic: topicPath(state.projectId, state.topic) });
}

/** Close owned clients exactly once; injected clients are never closed. */
export async function teardownPubSub(state: GcpPubSubState): Promise<void> {
  if (state.destroyed) {
    return;
  }
  state.destroyed = true;
  const pending: Promise<unknown>[] = [];
  if (state.ownsPublisher) {
    pending.push(state.publisher.close());
  }
  if (state.ownsSubscriber) {
    pending.push(state.subscriber.close());
  }
  await Promise.allSettled(pending);
}

/** Verify the subscription exists and report readiness. */
export async function healthPubSub(state: GcpPubSubState): Promise<{ ok: true }> {
  await state.subscriber.getSubscription({
    subscription: subscriptionPath(state.projectId, state.subscription),
  });
  return { ok: true };
}
