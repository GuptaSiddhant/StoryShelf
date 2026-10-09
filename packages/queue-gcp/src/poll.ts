/** Synchronous-pull polling with ack/nack semantics for Pub/Sub. */
import type { LeaseRenewal, PollableJob } from "@storyshelf/core/adapter/capture-queue";
import { decodeData, parseBody, subscriptionPath } from "./codec.ts";
import type { GcpPubSubState, PulledMessage } from "./types.ts";

/** Pull one message; malformed bodies are acked and yield `null`. */
export async function pollPubSub(state: GcpPubSubState): Promise<PollableJob | null> {
  const pulled = await receiveSingle(state);
  if (!pulled) {
    return null;
  }
  const body = parseBody(pulled.raw);
  if (!body.buildId || !pulled.ackId) {
    await discardUnusable(state, pulled);
    return null;
  }
  await setLease(state, pulled.ackId);
  return {
    buildId: body.buildId,
    reqId: body.reqId,
    traceparent: body.traceparent,
    receipt: pulled.ackId,
    leaseMs: state.leaseSeconds * 1000,
    attempts: Math.max(0, (pulled.deliveryAttempt ?? 1) - 1),
    raw: pulled.received,
  };
}

/** Pull at most one message; empty payloads stay for redelivery. */
export async function receiveSingle(state: GcpPubSubState): Promise<PulledMessage | null> {
  const [response] = await state.subscriber.pull({
    subscription: subscriptionPath(state.projectId, state.subscription),
    maxMessages: 1,
  });
  const [received] = response.receivedMessages ?? [];
  const data = received?.message?.data;
  if (!data || data.length === 0) {
    return null;
  }
  return {
    ackId: received.ackId,
    deliveryAttempt: received.deliveryAttempt,
    raw: decodeData(data),
    received,
  };
}

/** Ack a message whose body is unusable, logging the raw payload. */
export async function discardMalformed(
  state: GcpPubSubState,
  ackId: string,
  raw: string,
): Promise<void> {
  await state.subscriber
    .acknowledge({
      subscription: subscriptionPath(state.projectId, state.subscription),
      ackIds: [ackId],
    })
    .catch(() => {
      // Best effort: the message is already unusable, so ignore ack failures.
    });
  state.logger?.warn({ body: raw }, "received malformed Pub/Sub message without buildId");
}

/** Discard unusable pulls: ack when possible, warn when no ackId exists. */
export async function discardUnusable(state: GcpPubSubState, pulled: PulledMessage): Promise<void> {
  if (pulled.ackId) {
    await discardMalformed(state, pulled.ackId, pulled.raw);
  } else {
    state.logger?.warn({ body: pulled.raw }, "received Pub/Sub message without ackId");
  }
}

/** Acknowledge a receipted job; jobs without receipts are a no-op. */
export async function ackPubSub(state: GcpPubSubState, job: PollableJob): Promise<void> {
  if (!job.receipt) {
    return;
  }
  await state.subscriber.acknowledge({
    subscription: subscriptionPath(state.projectId, state.subscription),
    ackIds: [job.receipt],
  });
}

/** Convert an optional `delayMs` into whole ack-deadline seconds. */
export function delaySecondsFor(nackOptions?: { delayMs?: number }): number | undefined {
  if (nackOptions?.delayMs === undefined) {
    return undefined;
  }
  return Math.max(0, Math.ceil(nackOptions.delayMs / 1000));
}

/** Nack: drop on `requeue: false`, else redeliver (honoring `delayMs`). */
export async function nackPubSub(
  state: GcpPubSubState,
  job: PollableJob,
  nackOptions?: { requeue?: boolean; delayMs?: number },
): Promise<void> {
  if (!job.receipt) {
    return;
  }
  const subscription = subscriptionPath(state.projectId, state.subscription);
  if (nackOptions?.requeue === false) {
    await state.subscriber.acknowledge({ subscription, ackIds: [job.receipt] });
    return;
  }
  const delaySeconds = delaySecondsFor(nackOptions);
  await state.subscriber.modifyAckDeadline({
    subscription,
    ackIds: [job.receipt],
    ackDeadlineSeconds: delaySeconds ?? 0,
  });
}

/** gRPC INVALID_ARGUMENT: the ack id is expired or already settled. */
const GRPC_INVALID_ARGUMENT = 3;

/** Set the message's ack deadline to the configured lease, starting from now. */
async function setLease(state: GcpPubSubState, ackId: string): Promise<void> {
  await state.subscriber.modifyAckDeadline({
    subscription: subscriptionPath(state.projectId, state.subscription),
    ackIds: [ackId],
    ackDeadlineSeconds: state.leaseSeconds,
  });
}

/** Extend the ack deadline by another lease; a rejected ack id means the lease is lost. */
export async function extendPubSub(state: GcpPubSubState, job: PollableJob): Promise<LeaseRenewal> {
  if (!job.receipt) {
    return "ok";
  }
  try {
    await setLease(state, job.receipt);
    return "ok";
  } catch (error) {
    if ((error as { code?: number }).code === GRPC_INVALID_ARGUMENT) {
      return "lost";
    }
    throw error;
  }
}
