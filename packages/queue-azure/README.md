# @storyshelf/queue-azure

Azure capture job queue adapter for StoryShelf: pushes capture jobs to Azure Storage Queues or Azure Service Bus and leaves execution to a separately-assembled worker.

## Install

```sh
nub add @storyshelf/queue-azure
```

or

```sh
npm install @storyshelf/queue-azure
```

Then install only the backend SDK you use:

```sh
npm install @azure/storage-queue      # Storage Queues backend
# or
npm install @azure/service-bus        # Service Bus backend
```

Both SDKs are optional peer dependencies, so the package import stays light.

## Quick start (Storage Queues)

```ts
import { createAzureStorageQueuesQueue } from "@storyshelf/queue-azure/storage-queues";
import { createShelfApp } from "@storyshelf/app";

const queue = createAzureStorageQueuesQueue({
  queueName: "capture-jobs",
  connectionString: process.env.AZURE_STORAGE_CONNECTION!,
});

const app = createShelfApp({
  database,
  storage,
  captureRunner: myRenderer,
  captureQueue: queue,
});
```

## Quick start (Service Bus)

```ts
import { createAzureServiceBusQueue } from "@storyshelf/queue-azure/service-bus";
import { createShelfApp } from "@storyshelf/app";

const queue = createAzureServiceBusQueue({
  queueName: "capture-jobs",
  connectionString: process.env.AZURE_SERVICE_BUS_CONNECTION!,
});
```

## Runtime backend selection

When the backend is chosen at runtime, use the async dispatcher:

```ts
import { createAzureQueue } from "@storyshelf/queue-azure";

const queue = await createAzureQueue({
  backend: "service-bus",
  queueName: "capture-jobs",
  connectionString: process.env.AZURE_SERVICE_BUS_CONNECTION!,
});
```

## API

### `AzureStorageQueuesQueueOptions`

```ts
interface AzureStorageQueuesQueueOptions {
  queueName: string;         // required Storage queue name
  connectionString: string;  // required Storage account connection string
  client?: QueueClient;      // injected client (tests)
  logger?: Logger;
  visibilityTimeout?: number; // seconds, default 300
  waitMs?: number;            // poll HTTP timeout, default 20_000
}
```

Storage Queues has no long-polling: `poll` returns as soon as a message is (or is not) visible, and `waitMs` bounds the underlying request. `nack` releases the message back to the queue — immediately or after `delayMs` — while `requeue: false` deletes it (matching the SQS adapter). Attempts come from the queue's `dequeueCount`.

### `AzureServiceBusQueueOptions`

```ts
interface AzureServiceBusQueueOptions {
  queueName: string;         // required Service Bus queue name
  connectionString: string;  // required connection string
  client?: ServiceBusClient; // injected client (tests)
  sender?: Sender;
  receiver?: ServiceBusReceiver;
  adminClient?: ServiceBusAdministrationClient;
  logger?: Logger;
  waitMs?: number;            // receive maxWaitTimeInMs, default 30_000
}
```

Service Bus has no per-message visibility timeout, so `nack` always re-enqueues immediately (`delayMs` is not honored). Each abandon increments `deliveryCount`; past the queue's `maxDeliveryCount`, Service Bus dead-letters the message automatically — the Azure analog of the SQS + DLQ pattern.

## Local development

- Storage Queues: run the [Azurite](https://github.com/Azure/Azurite) emulator to develop against a local queue.
- Service Bus: no official local emulator exists — use a real namespace for integration testing.

## License

MIT