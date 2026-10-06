# @storyshelf/observability

OpenTelemetry tracing, metrics, and log correlation for StoryShelf adapters. This is the single OTEL owner in the monorepo.

## Install

```sh
nub add @storyshelf/observability
```

or

```sh
npm install @storyshelf/observability
```

## Usage

```ts
import { createInstrumentedDatabase, createInstrumentedStorage } from "@storyshelf/observability";

const database = createInstrumentedDatabase(baseDatabase);
const storage = createInstrumentedStorage(baseStorage);
```

See the [StoryShelf documentation](https://github.com/GuptaSiddhant/StoryShelf#readme) for configuration details.

## License

MIT
