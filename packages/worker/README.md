# @storyshelf/worker

Remote capture worker for StoryShelf: polls a CaptureQueue and runs the capture pipeline with any CaptureRunner.

## Install

```sh
nub add @storyshelf/worker
```

or

```sh
npm install @storyshelf/worker
```

## Usage

```ts
import { createCaptureWorker } from "@storyshelf/worker";

const handle = createCaptureWorker({/* database, storage, queue, runner */});
```

See the [StoryShelf documentation](https://github.com/GuptaSiddhant/StoryShelf#readme) for configuration details.

## Running as a forked child

For a server that captures in a child process (`capture.workerEntry`), call `runCaptureChild` instead of building a queue yourself. It polls the parent over IPC, runs the same capture worker, finishes in-flight captures on `SIGTERM`, and exits at once if the parent goes away:

```ts
import { runCaptureChild } from "@storyshelf/worker";

await runCaptureChild({ db, storage, runner, scratchDir });
```

It uses the database adapter's own tables and sizes concurrency from the parent's `capture.concurrency`.

## License

MIT
