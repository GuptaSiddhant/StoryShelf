/** Pub/Sub client construction and ownership flags. */
import { v1 } from "@google-cloud/pubsub";
import type { GcpPubSubQueueOptions, GcpPubSubState } from "./types.ts";

/** Build runtime state, constructing owned clients unless injected. */
export function createPubSubState(options: GcpPubSubQueueOptions): GcpPubSubState {
  const clientOptions = {
    projectId: options.projectId,
    apiEndpoint: options.apiEndpoint,
    keyFilename: options.keyFilename,
  };
  const publisher = options.publisher ?? new v1.PublisherClient(clientOptions);
  const subscriber = options.subscriber ?? new v1.SubscriberClient(clientOptions);
  return {
    projectId: options.projectId,
    topic: options.topic,
    subscription: options.subscription,
    publisher,
    subscriber,
    ownsPublisher: options.publisher === undefined,
    ownsSubscriber: options.subscriber === undefined,
    logger: options.logger,
    destroyed: false,
  };
}
