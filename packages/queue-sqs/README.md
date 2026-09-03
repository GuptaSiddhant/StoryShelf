# @storyshelf/queue-sqs

SQS capture job queue adapter for StoryShelf: pushes capture jobs to AWS SQS and leaves execution to a separately-assembled worker.

## Install

```sh
nub add @storyshelf/queue-sqs
```

or

```sh
npm install @storyshelf/queue-sqs
```

## Quick start

```ts
import { createSqsCaptureQueue } from "@storyshelf/queue-sqs";
import { createShelfRouter } from "@storyshelf/core";

const queue = createSqsCaptureQueue({
  queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
});

const app = createShelfRouter({
  database, storage,
  captureRunner: myRenderer,
  captureQueue: queue,
});
```

## API

### `SqsCaptureQueueOptions`

```ts
interface SqsCaptureQueueOptions {
  queueUrl: string;           // required SQS queue URL
  client?: SqsClient;         // optional pre-configured client
  logger?: Logger;            // optional pino logger
}
```

### `createSqsCaptureQueue(options: SqsCaptureQueueOptions): CaptureQueue`

Creates an SQS-backed `CaptureQueue`. The returned adapter implements every method of the `CaptureQueue` interface (`enqueue`, `status`, `active`, `recent`). Jobs are submitted via `SendMessage` and retrieved via `ReceiveMessage`; messages are deleted after reading to prevent re-processing.

## How it fits in

`queue-sqs` is the `captureQueue` option for `createShelfRouter` in AWS/cloud deployments. It implements the same `CaptureQueue` interface as `InMemoryCaptureQueue` (exported from `@storyshelf/core`), so switching between in-process and remote queues requires no changes to router or build logic.

See `docs/architecture.md` and ADR 0009.

## SQS Queue Worker

A separate worker process (Node, Bun, etc.) polls the SQS queue and calls `executeCaptureJob` from `@storyshelf/core`:

```ts
import { executeCaptureJob } from "@storyshelf/core";
import { SqsClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";

while (true) {
  const msg = await sqsClient.send(new ReceiveMessageCommand({ ... }));
  const { buildId, reqId } = JSON.parse(msg.Body!);
  await executeCaptureJob({ buildId, reqId }, jobOptions);
  await sqsClient.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }));
}
```

## Development

```sh
nub run build     # bundle with tsdown
nub run fmt       # format with oxfmt
nub run lint      # type-aware lint with oxlint
nub run test      # vitest suite
```