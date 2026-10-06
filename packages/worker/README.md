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

const handle = createCaptureWorker({ /* database, storage, queue, runner */ });
```

See the [StoryShelf documentation](https://github.com/GuptaSiddhant/StoryShelf#readme) for configuration details.

## License

MIT
