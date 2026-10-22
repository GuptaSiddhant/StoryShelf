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

For a server that captures in a child process (`testing.workerEntry`), call `runCaptureChild` instead of building a queue yourself. The app pushes each leased job to the child over IPC and the child runs the core capture pipeline for it (`runCaptureChild` now lives in `@storyshelf/core/capture`; this package re-exports it), finishes in-flight captures on `SIGTERM`, and exits at once if the parent goes away:

```ts
import { runCaptureChild } from "@storyshelf/worker";

await runCaptureChild({ db, storage, runner, scratchDir });
```

It uses the database adapter's own tables; the app holds the concurrency slots (`testing.concurrency`) and the child never reads the queue.

## License

MIT
