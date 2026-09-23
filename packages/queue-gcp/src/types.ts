/** Queue option and runtime state types for the GCP Pub/Sub adapter. */
import type { v1 } from "@google-cloud/pubsub";
import type { Logger } from "@storyshelf/core/logger";

/** Options for creating a GCP Pub/Sub-backed capture queue. */
export interface GcpPubSubQueueOptions {
  /** Pub/Sub topic short name (e.g. `capture-jobs`). */
  topic: string;
  /** Pull subscription short name (e.g. `capture-jobs-worker`). */
  subscription: string;
  /** GCP project ID. */
  projectId: string;
  /** Optional pre-configured publisher client, injected for tests. */
  publisher?: v1.PublisherClient;
  /** Optional pre-configured subscriber client, injected for tests. */
  subscriber?: v1.SubscriberClient;
  /** Optional logger for queue diagnostics. */
  logger?: Logger;
  /** Custom API endpoint (Pub/Sub emulator host). */
  apiEndpoint?: string;
  /** Path to a service-account JSON key file. */
  keyFilename?: string;
}

/** Mutable runtime state threaded through lifecycle, operations, and poll. */
export interface GcpPubSubState {
  projectId: string;
  topic: string;
  subscription: string;
  publisher: v1.PublisherClient;
  subscriber: v1.SubscriberClient;
  ownsPublisher: boolean;
  ownsSubscriber: boolean;
  logger?: Logger;
  destroyed: boolean;
}

/** Body stored in a Pub/Sub message. */
export interface QueuedBody {
  buildId?: string;
  reqId?: string;
  queuedAt?: string;
  status?: string;
}

/** A single synchronously-pulled message with its decoded body. */
export interface PulledMessage {
  ackId?: string | null;
  deliveryAttempt?: number | null;
  raw: string;
  received: unknown;
}
