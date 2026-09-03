---
title: "@storyshelf/queue-sqs"
description: AWS SQS capture job queue adapter for StoryShelf cloud deployments.
---

`@storyshelf/queue-sqs` backs StoryShelf's capture queue with AWS SQS for cloud/serverless deployments. It implements the `CaptureQueue` contract from `@storyshelf/core`: `enqueue` submits a build for capture (returning once queued), and a separately-assembled worker polls the queue and runs `executeCaptureJob`. Because it implements the same interface as the in-process `InMemoryCaptureQueue`, switching between in-process and remote capture is a single dependency swap — no router or build changes.

## Install

```sh
nub add @storyshelf/queue-sqs
```

## Register the queue

Pass the SQS-backed queue as the `captureQueue` option of `createShelfRouter`:

```ts
import { createShelfRouter } from "@storyshelf/core";
import { createSqsCaptureQueue } from "@storyshelf/queue-sqs";

const queue = createSqsCaptureQueue({
  queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/capture-jobs",
});

const app = createShelfRouter({
  database,
  storage,
  captureRunner: myRenderer,
  captureQueue: queue,
});
```

## Options

```ts
interface SqsCaptureQueueOptions {
  queueUrl: string;   // required SQS queue URL
  client?: SqsClient; // optional pre-configured client
  logger?: Logger;    // optional pino logger
}
```

Jobs are submitted via `SendMessage` and retrieved via `ReceiveMessage`; messages are deleted after reading to prevent re-processing.

## Run a worker

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

## When to use it

Use `queue-sqs` on platforms without a long-lived Node process — AWS Lambda, ECS/Fargate with a dedicated worker, or any AWS-hosted stack where capture should run in a decoupled worker rather than in-process. For a simple single-host deployment, the default `InMemoryCaptureQueue` is sufficient and needs no extra infrastructure.
