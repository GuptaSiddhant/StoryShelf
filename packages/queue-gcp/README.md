# @storyshelf/queue-gcp

GCP capture job queue adapter for StoryShelf: pushes capture jobs to Cloud Pub/Sub and leaves execution to a separately-assembled worker.

## Install

```sh
nub add @storyshelf/queue-gcp
```

or

```sh
npm install @storyshelf/queue-gcp @google-cloud/pubsub
```

The Pub/Sub SDK is an optional peer dependency, so the package import stays light without it.

## Quick start

```ts
import { createGcpPubSubQueue } from "@storyshelf/queue-gcp";
import { createShelfApp } from "@storyshelf/app";

const queue = createGcpPubSubQueue({
  topic: "capture-jobs",
  subscription: "capture-jobs-worker",
  projectId: process.env.GOOGLE_CLOUD_PROJECT!,
});

const app = createShelfApp({
  database,
  storage,
  captureRunner: myRenderer,
  captureQueue: queue,
});
```

Authentication uses Application Default Credentials (`gcloud auth application-default login`,
workload identity, or a service-account key file via `keyFilename`).

## API

### `GcpPubSubQueueOptions`

```ts
interface GcpPubSubQueueOptions {
  topic: string;        // required Pub/Sub topic short name
  subscription: string; // required pull subscription short name
  projectId: string;    // required GCP project ID
  publisher?: PublisherClient;  // injected client (tests)
  subscriber?: SubscriberClient; // injected client (tests)
  logger?: Logger;
  apiEndpoint?: string; // custom endpoint (Pub/Sub emulator host)
  keyFilename?: string; // service-account JSON key file
}
```

Synchronous pull fetches one message per `poll` (no streaming state, mirroring
the Storage Queues adapter): `poll` returns `null` immediately when the
subscription is empty. `ack` acknowledges; `nack` redelivers immediately,
honors `delayMs` via `modifyAckDeadline`, and drops the message when
`requeue: false`. Attempts come from `deliveryAttempt` (1-indexed). Poison
messages dead-letter through the subscription's `deadLetterPolicy`
(`maxDeliveryAttempts`) — the GCP analog of the SQS + DLQ pattern.

## Local development

Run the [Pub/Sub emulator](https://cloud.google.com/pubsub/docs/emulator)
(`gcloud beta emulators pubsub start`) and point the adapter at it with
`apiEndpoint`, or inject mock clients as the test suite does.

## License

MIT
